const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const pLimitModule = require('p-limit');
const pLimit = pLimitModule.default;
const { generateCombos } = require('./comboGenerator');
const jobManager = require('./jobManager');
const { calculateCost, extractUsage, formatCost, formatTokens } = require('./pricing');

const app = express();
const PORT = 3000;

// Configuration for parallel generation (with environment variable overrides)
const DEFAULT_CONCURRENCY = parseInt(process.env.TRANSCRIPT_CONCURRENCY || '5', 10); // Number of concurrent API requests (default: 5)
const MAX_RETRIES = parseInt(process.env.TRANSCRIPT_MAX_RETRIES || '2', 10);
const RETRY_DELAY_MS = parseInt(process.env.TRANSCRIPT_RETRY_DELAY_MS || '1000', 10);
const RATE_LIMIT_DELAY_MS = parseInt(process.env.TRANSCRIPT_RATE_LIMIT_DELAY_MS || '500', 10); // Delay between API calls

// Tracking for rate limit monitoring
const apiCallMetrics = {
    callsInLastMinute: 0,
    lastResetTime: Date.now(),
    rateLimitErrors: 0
};

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Temporary storage for generated files
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Helper function to sanitize filenames
function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-z0-9_-]/gi, '_')
        .replace(/_+/g, '_')
        .toLowerCase();
}

// Helper function to generate a random date within the last year
function generateRandomDate() {
    const now = new Date();
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const randomTime = yearAgo.getTime() + Math.random() * (now.getTime() - yearAgo.getTime());
    const randomDate = new Date(randomTime);
    return randomDate.toISOString().split('T')[0];
}

// Helper function to retry API calls with exponential backoff
async function retryWithBackoff(fn, maxRetries = MAX_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Track rate limit errors
            if (error.status === 429 || error.message?.includes('rate limit') || error.message?.includes('429')) {
                apiCallMetrics.rateLimitErrors++;
                console.warn(`⚠️ Rate limit hit (error #${apiCallMetrics.rateLimitErrors}). Retrying with backoff...`);
            }

            if (attempt < maxRetries) {
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
                console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

// Helper function to check job state and handle pause/cancel
async function checkJobState(jobId) {
    let job = jobManager.getJob(jobId);
    if (!job || job.state === 'cancelled') {
        return 'cancelled';
    }

    while (job.state === 'paused') {
        await new Promise(resolve => setTimeout(resolve, 500));
        job = jobManager.getJob(jobId);
        if (!job || job.state === 'cancelled') {
            return 'cancelled';
        }
    }

    return 'running';
}

// Main endpoint to generate transcripts
// Supported models for transcript generation
const SUPPORTED_TRANSCRIPT_MODELS = [
    'claude-3-7-sonnet-20250219',
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-1-20250805',
    'claude-haiku-4-5-20251001'
];

// Token limits per model for transcript generation
// Different models have different optimal token allocations
const TOKEN_LIMITS_BY_MODEL = {
    'claude-haiku-4-5-20251001': {
        series: 7500,     // Haiku 4.5: maximize tokens for series (4 episodes)
        single: 7500      // Haiku 4.5: use most of available tokens for complete transcripts
    },
    'claude-3-7-sonnet-20250219': {
        series: 7500,     // Sonnet 3.7: good balance
        single: 7000
    },
    'claude-sonnet-4-5-20250929': {
        series: 7500,     // Sonnet 4.5: default high-quality
        single: 7000
    },
    'claude-opus-4-1-20250805': {
        series: 7500,     // Opus: premium quality, can use more tokens
        single: 7000
    }
};

// Helper function to get token limits for a specific model
function getTokenLimits(model) {
    return TOKEN_LIMITS_BY_MODEL[model] || { series: 7500, single: 7000 };
}

app.post('/generate', async (req, res) => {
    const { apiKey, transcriptCount, prompt, jobId, model } = req.body;

    if (!apiKey || !transcriptCount || !prompt || !jobId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate and set model (default to Sonnet 4.5 if not provided)
    let selectedModel = model || 'claude-sonnet-4-5-20250929';
    if (!SUPPORTED_TRANSCRIPT_MODELS.includes(selectedModel)) {
        return res.status(400).json({ error: `Unsupported model: ${selectedModel}` });
    }

    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const anthropic = new Anthropic({ apiKey });
    const sessionDir = path.join(TEMP_DIR, `session_${jobId}`);

    try {
        // Step 1: Generate coach/client combos using Claude Haiku
        res.write(`data: ${JSON.stringify({
            type: 'status',
            message: 'Generating coach/client combinations...'
        })}\n\n`);

        let combos;
        try {
            combos = await generateCombos(transcriptCount, apiKey);
        } catch (error) {
            throw new Error(`Failed to generate combos: ${error.message}`);
        }

        if (combos.length !== transcriptCount) {
            throw new Error(`Generated ${combos.length} combos but expected ${transcriptCount}`);
        }

        // Update job in manager with actual combos
        jobManager.createJob(jobId, transcriptCount, combos);

        // Initialize cost tracking for this job
        const costTracking = {
            usageRecords: [],
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCost: 0
        };

        res.write(`data: ${JSON.stringify({
            type: 'status',
            message: `Generated ${combos.length} coach/client combinations. Starting transcript generation...`
        })}\n\n`);

        // Create session directory
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Step 2: Group transcripts by series for batch processing
        const seriesMap = new Map();
        const singleTranscripts = [];

        for (let i = 0; i < combos.length; i++) {
            const combo = combos[i];
            if (combo.isSeriesEpisode) {
                const seriesId = combo.seriesId;
                if (!seriesMap.has(seriesId)) {
                    seriesMap.set(seriesId, []);
                }
                seriesMap.get(seriesId).push({ comboIndex: i, ...combo });
            } else {
                singleTranscripts.push({ comboIndex: i, ...combo });
            }
        }

        res.write(`data: ${JSON.stringify({
            type: 'status',
            message: `Grouped ${seriesMap.size} series (${seriesMap.size * 4} episodes) and ${singleTranscripts.length} single transcripts`
        })}\n\n`);

        let currentProgress = 0;
        const totalItems = transcriptCount;
        const limit = pLimit(DEFAULT_CONCURRENCY);
        const rateLimitQueue = { lastCall: Date.now() }; // Track last API call for rate limiting

        // Helper function to apply rate limiting delay
        const applyRateLimit = async () => {
            const timeSinceLastCall = Date.now() - rateLimitQueue.lastCall;
            if (timeSinceLastCall < RATE_LIMIT_DELAY_MS) {
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastCall));
            }
            rateLimitQueue.lastCall = Date.now();
        };

        // Helper function to generate series with error tracking
        const generateSeries = async (seriesId, seriesEpisodes) => {
            const state = await checkJobState(jobId);
            if (state === 'cancelled') {
                throw new Error('Job cancelled');
            }

            try {
                const coach = seriesEpisodes[0].coach;
                const client = seriesEpisodes[0].client;
                const location = seriesEpisodes[0].location;
                const niche = seriesEpisodes[0].niche;

                // Generate all 4 episodes for this series in one call
                const seriesPrompt = `${prompt}

IMPORTANT: This is a 4-episode series between the same coach and client. Generate all 4 episodes showing progression and continuity.

Coach: ${coach}
Client: ${client}
Location: ${location}
Coaching Niche/Focus: ${niche}

Episode 1: First session - introductory call covering general business situation
Episode 2: Follow-up (1 week later) - client reports on action items, they discuss progress
Episode 3: Follow-up (1 week later) - deeper into a specific business challenge introduced in previous calls
Episode 4: Follow-up (1 week later) - resolution/implementation of strategies discussed, new goals set

Generate all 4 episodes. Each episode should be 25-30 minutes of conversation with timestamps. Make sure:
- The conversation shows progression and relationship building
- Previous topics are referenced and built upon
- The client shows growth/progress over the 4 weeks
- Different dates for each episode (weekly intervals)
- Format each episode separately with clear episode markers`;

                const tokenLimits = getTokenLimits(selectedModel);
                await applyRateLimit();
                const message = await retryWithBackoff(async () => {
                    return await anthropic.messages.create({
                        model: selectedModel,
                        max_tokens: tokenLimits.series,
                        messages: [{
                            role: 'user',
                            content: seriesPrompt
                        }]
                    });

                });

                // Extract and track token usage
                const usage = extractUsage(message);
                costTracking.usageRecords.push({
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    model: selectedModel,
                    type: 'series'
                });
                costTracking.totalInputTokens += usage.inputTokens;
                costTracking.totalOutputTokens += usage.outputTokens;

                const seriesContent = message.content[0].text;

                // Split the response into individual episodes and save them
                const episodes = splitSeriesContent(seriesContent, seriesEpisodes);

                for (let episodeIdx = 0; episodeIdx < episodes.length; episodeIdx++) {
                    const episodeContent = episodes[episodeIdx];
                    const episode = seriesEpisodes[episodeIdx];
                    const date = generateRandomDate();

                    const filename = `${sanitizeFilename(coach)}_${sanitizeFilename(client)}_${date}_ep${episode.episodeNumber}_of_${episode.totalEpisodes}.md`;
                    const filepath = path.join(sessionDir, filename);

                    fs.writeFileSync(filepath, episodeContent, 'utf8');

                    // Update job progress
                    jobManager.updateProgress(jobId, currentProgress, filename);

                    currentProgress++;

                    // Calculate current cumulative cost
                    const currentCost = calculateCost(
                        costTracking.totalInputTokens,
                        costTracking.totalOutputTokens,
                        selectedModel
                    );
                    costTracking.totalCost = currentCost.totalCost;

                    res.write(`data: ${JSON.stringify({
                        type: 'progress',
                        current: currentProgress,
                        total: totalItems,
                        filename: filename,
                        context: `Series "${coach} & ${client}" - Episode ${episode.episodeNumber}/4`,
                        tokens: formatTokens(currentCost.totalTokens),
                        cost: formatCost(currentCost.totalCost)
                    })}\n\n`);
                }

                return { success: true, seriesId };
            } catch (error) {
                console.error(`Error generating series ${seriesId}:`, error);
                return { success: false, seriesId, error: error.message };
            }
        };

        // Helper function to generate single transcript with error tracking
        const generateSingle = async (singleCombo, index) => {
            const state = await checkJobState(jobId);
            if (state === 'cancelled') {
                throw new Error('Job cancelled');
            }

            try {
                const singlePrompt = `${prompt}

Coach: ${singleCombo.coach}
Client: ${singleCombo.client}
Location: ${singleCombo.location}
Coaching Niche/Focus: ${singleCombo.niche}

Generate ONE standalone transcript for this single coaching session (not part of a series). This should be a complete 25-30 minute conversation with realistic dialogue, timestamps, and details.`;

                 const tokenLimits = getTokenLimits(selectedModel);
                await applyRateLimit();
                const message = await retryWithBackoff(async () => {
                    return await anthropic.messages.create({
                        model: selectedModel,
                        max_tokens: tokenLimits.single,
                        messages: [{
                            role: 'user',
                            content: singlePrompt
                        }]
                    });
                });

                // Extract and track token usage
                const usage = extractUsage(message);
                costTracking.usageRecords.push({
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    model: selectedModel,
                    type: 'single'
                });
                costTracking.totalInputTokens += usage.inputTokens;
                costTracking.totalOutputTokens += usage.outputTokens;

                const transcriptContent = message.content[0].text;
                const date = generateRandomDate();
                const filename = `${sanitizeFilename(singleCombo.coach)}_${sanitizeFilename(singleCombo.client)}_${date}_single.md`;
                const filepath = path.join(sessionDir, filename);

                fs.writeFileSync(filepath, transcriptContent, 'utf8');

                // Update job progress
                jobManager.updateProgress(jobId, currentProgress, filename);

                currentProgress++;

                // Calculate current cumulative cost
                const currentCost = calculateCost(
                    costTracking.totalInputTokens,
                    costTracking.totalOutputTokens,
                    selectedModel
                );
                costTracking.totalCost = currentCost.totalCost;

                res.write(`data: ${JSON.stringify({
                    type: 'progress',
                    current: currentProgress,
                    total: totalItems,
                    filename: filename,
                    tokens: formatTokens(currentCost.totalTokens),
                    cost: formatCost(currentCost.totalCost)
                })}\n\n`);

                return { success: true, index };
            } catch (error) {
                console.error(`Error generating single transcript at index ${index}:`, error);
                return { success: false, index, error: error.message };
            }
        };

        // Step 3: Generate series transcripts in parallel
        res.write(`data: ${JSON.stringify({
            type: 'status',
            message: `Starting parallel generation with ${DEFAULT_CONCURRENCY} concurrent requests...`
        })}\n\n`);

        const seriesPromises = Array.from(seriesMap.entries()).map(([seriesId, episodes]) =>
            limit(() => generateSeries(seriesId, episodes))
        );

        const seriesResults = await Promise.all(seriesPromises);

        // Check for series generation errors
        const seriesErrors = seriesResults.filter(r => !r.success);
        if (seriesErrors.length > 0) {
            console.warn(`${seriesErrors.length} series failed to generate`);
            for (const error of seriesErrors) {
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    message: `Failed to generate series ${error.seriesId}: ${error.error}`
                })}\n\n`);
            }
        }

        // Step 4: Generate single transcripts in parallel
        const singlePromises = singleTranscripts.map((combo, index) =>
            limit(() => generateSingle(combo, index))
        );

        const singleResults = await Promise.all(singlePromises);

        // Check for single generation errors
        const singleErrors = singleResults.filter(r => !r.success);
        if (singleErrors.length > 0) {
            console.warn(`${singleErrors.length} single transcripts failed to generate`);
            for (const error of singleErrors) {
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    message: `Failed to generate transcript at index ${error.index}: ${error.error}`
                })}\n\n`);
            }
        }

        // Create ZIP file
        const zipFilename = `transcripts_${jobId}.zip`;
        const zipPath = path.join(TEMP_DIR, zipFilename);

        await createZipFile(sessionDir, zipPath);

        // Mark job as completed
        jobManager.completeJob(jobId);

        // Calculate and report performance metrics
        const stats = jobManager.getJobStats(jobId);
        const totalTime = (stats.elapsedTime / 1000).toFixed(2);
        const avgTimePerTranscript = (stats.elapsedTime / stats.totalCount).toFixed(2);

        console.log(`\n✅ Generation Complete!`);
        console.log(`   Concurrency: ${DEFAULT_CONCURRENCY} concurrent requests`);
        console.log(`   Transcripts: ${stats.totalCount}`);
        console.log(`   Total Time: ${totalTime}s`);
        console.log(`   Avg per Transcript: ${avgTimePerTranscript}ms`);
        if (apiCallMetrics.rateLimitErrors > 0) {
            console.log(`   ⚠️ Rate Limit Errors: ${apiCallMetrics.rateLimitErrors}`);
        }
        console.log('');

        // Send completion message with cost breakdown
        const finalCost = calculateCost(
            costTracking.totalInputTokens,
            costTracking.totalOutputTokens,
            selectedModel
        );

        console.log(`   Input Tokens: ${formatTokens(finalCost.inputTokens)}`);
        console.log(`   Output Tokens: ${formatTokens(finalCost.outputTokens)}`);
        console.log(`   Total Tokens: ${formatTokens(finalCost.totalTokens)}`);
        console.log(`   Total Cost: ${formatCost(finalCost.totalCost)}`);

        res.write(`data: ${JSON.stringify({
            type: 'complete',
            downloadUrl: `/download/${zipFilename}`,
            stats: {
                concurrency: DEFAULT_CONCURRENCY,
                totalTime: parseFloat(totalTime),
                avgTimePerTranscript: parseFloat(avgTimePerTranscript),
                rateLimitErrors: apiCallMetrics.rateLimitErrors,
                cost: {
                    inputTokens: finalCost.inputTokens,
                    outputTokens: finalCost.outputTokens,
                    totalTokens: finalCost.totalTokens,
                    inputCost: finalCost.inputCost,
                    outputCost: finalCost.outputCost,
                    totalCost: finalCost.totalCost,
                    formattedCost: formatCost(finalCost.totalCost),
                    formattedTokens: formatTokens(finalCost.totalTokens)
                }
            }
        })}\n\n`);

        res.end();

        // Clean up session directory (but keep zip)
        setTimeout(() => {
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
        }, 1000);

    } catch (error) {
        console.error('Generation error:', error);
        res.write(`data: ${JSON.stringify({
            type: 'error',
            message: error.message
        })}\n\n`);
        res.end();

        // Clean up on error
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }

        // Try to cancel job if it exists (it may not exist if error occurred during combo generation)
        try {
            jobManager.cancelJob(jobId);
        } catch (cancelError) {
            // Job might not exist yet, that's okay
        }
    }
});

// Pause job endpoint
app.post('/pause/:jobId', (req, res) => {
    const { jobId } = req.params;

    try {
        const job = jobManager.pauseJob(jobId);
        const stats = jobManager.getJobStats(jobId);

        res.json({
            success: true,
            message: 'Job paused',
            stats: stats
        });
    } catch (error) {
        console.error(`Error pausing job ${jobId}:`, error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Resume job endpoint
app.post('/resume/:jobId', (req, res) => {
    const { jobId } = req.params;

    try {
        const job = jobManager.resumeJob(jobId);
        const stats = jobManager.getJobStats(jobId);

        res.json({
            success: true,
            message: 'Job resumed',
            stats: stats
        });
    } catch (error) {
        console.error(`Error resuming job ${jobId}:`, error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Cancel job endpoint
app.post('/cancel/:jobId', (req, res) => {
    const { jobId } = req.params;

    try {
        const job = jobManager.cancelJob(jobId);
        const stats = jobManager.getJobStats(jobId);

        res.json({
            success: true,
            message: 'Job cancelled',
            stats: stats
        });
    } catch (error) {
        console.error(`Error cancelling job ${jobId}:`, error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Get job status endpoint
app.get('/job-status/:jobId', (req, res) => {
    const { jobId } = req.params;

    try {
        const stats = jobManager.getJobStats(jobId);
        if (!stats) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }

        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error(`Error getting job status ${jobId}:`, error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Partial download endpoint (for cancelled/paused jobs)
app.get('/download-partial/:jobId', async (req, res) => {
    const { jobId } = req.params;

    try {
        const job = jobManager.getJob(jobId);
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const sessionDir = path.join(TEMP_DIR, `session_${jobId}`);
        if (!fs.existsSync(sessionDir)) {
            return res.status(404).json({ error: 'Session directory not found' });
        }

        // Create partial ZIP with completed transcripts
        const zipFilename = `transcripts_${jobId}_partial.zip`;
        const zipPath = path.join(TEMP_DIR, zipFilename);

        await createZipFile(sessionDir, zipPath);

        res.download(zipPath, zipFilename, (err) => {
            if (err) {
                console.error('Download error:', err);
            }
            // Delete file after download
            setTimeout(() => {
                if (fs.existsSync(zipPath)) {
                    fs.unlinkSync(zipPath);
                }
            }, 5000);
        });
    } catch (error) {
        console.error(`Error downloading partial results for ${jobId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Helper function to split series content into episodes
function splitSeriesContent(content, episodes) {
    // Try to split by episode markers
    const episodeTexts = [];
    const lines = content.split('\n');
    let currentEpisode = [];
    let episodeCount = 0;

    for (const line of lines) {
        if ((line.toLowerCase().includes('episode') && line.includes(':')) || line.match(/^#+\s+.*Episode\s+\d/i)) {
            if (currentEpisode.length > 0 && episodeCount > 0) {
                episodeTexts.push(currentEpisode.join('\n'));
                currentEpisode = [];
            }
            episodeCount++;
        }
        currentEpisode.push(line);
    }

    // Don't forget the last episode
    if (currentEpisode.length > 0) {
        episodeTexts.push(currentEpisode.join('\n'));
    }

    // If we couldn't parse episodes properly, split approximately
    if (episodeTexts.length < episodes.length) {
        const linesPerEpisode = Math.floor(lines.length / episodes.length);
        episodeTexts.length = 0;

        for (let i = 0; i < episodes.length; i++) {
            const start = i * linesPerEpisode;
            const end = i === episodes.length - 1 ? lines.length : (i + 1) * linesPerEpisode;
            episodeTexts.push(lines.slice(start, end).join('\n'));
        }
    }

    // Ensure we have the right number of episodes
    return episodeTexts.slice(0, episodes.length);
}

// Helper function to create ZIP file
function createZipFile(sourceDir, outputPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        output.on('close', () => {
            resolve();
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

// Download endpoint
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(TEMP_DIR, filename);

    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.download(filepath, filename, (err) => {
        if (err) {
            console.error('Download error:', err);
        }
        // Delete file after download
        setTimeout(() => {
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        }, 5000);
    });
});

// Clean up old temp files on startup
function cleanupTempFiles() {
    if (fs.existsSync(TEMP_DIR)) {
        const files = fs.readdirSync(TEMP_DIR);
        files.forEach(file => {
            const filepath = path.join(TEMP_DIR, file);
            const stats = fs.statSync(filepath);
            const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);

            // Delete files older than 1 hour
            if (ageHours > 1) {
                if (stats.isDirectory()) {
                    fs.rmSync(filepath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(filepath);
                }
            }
        });
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Transcript Generator Server Started!\n`);
    console.log(`📍 Open your browser and navigate to: http://localhost:${PORT}\n`);
    cleanupTempFiles();
});
