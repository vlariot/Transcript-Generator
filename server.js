const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

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

// Main endpoint to generate transcripts
app.post('/generate', async (req, res) => {
    const { apiKey, transcriptCount, prompt } = req.body;

    if (!apiKey || !transcriptCount || !prompt) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const anthropic = new Anthropic({ apiKey });
    const sessionId = Date.now();
    const sessionDir = path.join(TEMP_DIR, `session_${sessionId}`);

    try {
        // Create session directory
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Generate transcripts one by one
        for (let i = 1; i <= transcriptCount; i++) {
            try {
                // Create a specific request for each transcript
                const specificPrompt = `${prompt}

Please generate transcript ${i} of ${transcriptCount}. Generate ONE complete transcript following all the specifications above. Make sure each transcript is unique with different coach/client combinations, locations, and topics. Include realistic names, emails, and full 25-30 minute conversations with timestamps.`;

                // Call Claude API
                const message = await anthropic.messages.create({
                    model: 'claude-sonnet-4-5-20250929',
                    max_tokens: 16000,
                    messages: [{
                        role: 'user',
                        content: specificPrompt
                    }]
                });

                const transcriptContent = message.content[0].text;

                // Extract names from the transcript for filename
                // Try to find coach and client names
                let coachName = 'coach';
                let clientName = 'client';

                const coachMatch = transcriptContent.match(/\*\*Coach:\*\*\s*([^\n]+)/i);
                const clientMatch = transcriptContent.match(/\*\*Client:\*\*\s*([^\n]+)/i);

                if (coachMatch) {
                    coachName = sanitizeFilename(coachMatch[1].trim());
                }
                if (clientMatch) {
                    clientName = sanitizeFilename(clientMatch[1].trim());
                }

                // Generate filename
                const date = generateRandomDate();
                const filename = `${coachName}_${clientName}_${date}_${i}.md`;
                const filepath = path.join(sessionDir, filename);

                // Write transcript to file
                fs.writeFileSync(filepath, transcriptContent, 'utf8');

                // Send progress update
                res.write(`data: ${JSON.stringify({
                    type: 'progress',
                    current: i,
                    total: transcriptCount,
                    filename: filename
                })}\n\n`);

                // Small delay to avoid rate limiting
                if (i < transcriptCount) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

            } catch (error) {
                console.error(`Error generating transcript ${i}:`, error);
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    message: `Failed to generate transcript ${i}: ${error.message}`
                })}\n\n`);
                throw error;
            }
        }

        // Create ZIP file
        const zipFilename = `transcripts_${sessionId}.zip`;
        const zipPath = path.join(TEMP_DIR, zipFilename);

        await createZipFile(sessionDir, zipPath);

        // Send completion message
        res.write(`data: ${JSON.stringify({
            type: 'complete',
            downloadUrl: `/download/${zipFilename}`
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
    }
});

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
