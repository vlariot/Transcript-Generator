const form = document.getElementById('generatorForm');
const generateBtn = document.getElementById('generateBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const jobStats = document.getElementById('jobStats');
const completedCount = document.getElementById('completedCount');
const totalCount = document.getElementById('totalCount');
const statusLog = document.getElementById('statusLog');
const resultContainer = document.getElementById('resultContainer');
const downloadBtn = document.getElementById('downloadBtn');
const cancelledContainer = document.getElementById('cancelledContainer');
const cancelledMessage = document.getElementById('cancelledMessage');
const cancelledStats = document.getElementById('cancelledStats');
const downloadPartialBtn = document.getElementById('downloadPartialBtn');
const startNewBtn = document.getElementById('startNewBtn');
const errorContainer = document.getElementById('errorContainer');
const errorMessage = document.getElementById('errorMessage');

const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const cancelBtn = document.getElementById('cancelBtn');

const modelSelect = document.getElementById('modelSelect');
const modelInfo = document.getElementById('modelInfo');
const costEstimate = document.getElementById('costEstimate');
const estimateDetails = document.getElementById('estimateDetails');
const costEstimateToggle = document.getElementById('costEstimateToggle');

let downloadUrl = null;
let currentJobId = null;
let jobState = 'idle'; // idle, running, paused, cancelled, completed

// Pricing constants (per million tokens)
const modelPricing = {
    'claude-haiku-4-5-20251001': {
        name: 'Haiku 4.5',
        inputPrice: 0.80,
        outputPrice: 4.00
    },
    'claude-3-7-sonnet-20250219': {
        name: 'Sonnet 3.7',
        inputPrice: 3.00,
        outputPrice: 15.00
    },
    'claude-sonnet-4-5-20250929': {
        name: 'Sonnet 4.5',
        inputPrice: 3.00,
        outputPrice: 15.00,
        // Sonnet 4.5 has dynamic pricing for prompts > 200K tokens
        inputPriceOverLimit: 6.00,
        outputPriceOverLimit: 22.50,
        tokenLimitThreshold: 200000,
        isDynamic: true
    },
    'claude-opus-4-1-20250805': {
        name: 'Opus 4.1',
        inputPrice: 15.00,
        outputPrice: 75.00
    }
};

// Estimated tokens per transcript based on empirical data
// These are conservative estimates
const ESTIMATED_TOKENS_PER_TRANSCRIPT = {
    input: 1500,   // Prompt tokens (fairly consistent)
    output: 8000   // Generated content (25-30 min transcript)
};

// Model information and metadata
const modelData = {
    'claude-3-7-sonnet-20250219': {
        name: 'Sonnet 3.7',
        speed: '⚡⚡',
        quality: '⭐⭐⭐',
        cost: '💰💰',
        description: 'Balanced performance - recommended for most use cases. Good quality with reasonable speed.'
    },
    'claude-sonnet-4-5-20250929': {
        name: 'Sonnet 4.5',
        speed: '⚡',
        quality: '⭐⭐⭐⭐',
        cost: '💰💰💰',
        description: 'Highest quality generation. Produces excellent transcripts with natural dialogue.'
    },
    'claude-opus-4-1-20250805': {
        name: 'Opus 4.1',
        speed: '🐌',
        quality: '⭐⭐⭐⭐⭐',
        cost: '💰💰💰💰',
        description: 'Premium quality but slowest. Best for when quality is paramount.'
    },
    'claude-haiku-4-5-20251001': {
        name: 'Haiku 4.5',
        speed: '⚡⚡⚡',
        quality: '⭐⭐',
        cost: '💰',
        description: 'Fast and budget-friendly. Good for testing and high-volume generation.'
    }
};

// Confirmation dialog helper
function confirmAction(message) {
    return confirm(message);
}

// Cost estimation functions
function formatTokens(tokens) {
    if (tokens >= 1000000) {
        return `${(tokens / 1000000).toFixed(2)}M`;
    } else if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`;
    } else {
        return `${tokens}`;
    }
}

function formatCost(cost) {
    if (cost < 0.001) {
        return `$${(cost * 1000000).toFixed(2)}µ`;
    } else if (cost < 0.01) {
        return `$${(cost * 1000).toFixed(2)}m`;
    } else {
        return `$${cost.toFixed(4)}`;
    }
}

function estimatePromptTokens(text) {
    // Rough estimation: ~4 characters per token for English text
    // This is a conservative estimate; actual token count may vary
    return Math.ceil(text.length / 4);
}

function estimateCost() {
    const transcriptCount = parseInt(document.getElementById('transcriptCount').value) || 1;
    const selectedModel = modelSelect.value;
    const pricing = modelPricing[selectedModel];
    const promptText = document.getElementById('prompt').value;

    if (!pricing) return;

    // Calculate series and single transcripts
    const seriesCount = Math.floor(transcriptCount / 10);
    const singlesCount = transcriptCount % 10;
    const totalSeriesTranscripts = seriesCount * 4;
    const totalTranscripts = totalSeriesTranscripts + singlesCount;

    // Estimate prompt tokens from actual prompt text
    const promptTokensPerRequest = estimatePromptTokens(promptText);

    // Estimate total tokens per request (prompt + context for each transcript)
    const tokensPerRequest = promptTokensPerRequest + ESTIMATED_TOKENS_PER_TRANSCRIPT.input;

    // Estimate tokens (prompt is sent once per transcript, so multiply by transcript count)
    const estimatedInputTokens = totalTranscripts * tokensPerRequest;
    const estimatedOutputTokens = totalTranscripts * ESTIMATED_TOKENS_PER_TRANSCRIPT.output;

    // Calculate costs - handle dynamic pricing for Sonnet 4.5
    let inputPrice = pricing.inputPrice;
    let outputPrice = pricing.outputPrice;
    let pricingNote = '';

    if (pricing.isDynamic && estimatedInputTokens > pricing.tokenLimitThreshold) {
        inputPrice = pricing.inputPriceOverLimit;
        outputPrice = pricing.outputPriceOverLimit;
        pricingNote = `<p style="color: #e53e3e; font-weight: bold; margin-top: 12px;">⚠️ <strong>Higher pricing tier:</strong> This estimate uses ${pricing.name}'s higher pricing for prompts > 200K tokens ($${inputPrice}/M input, $${outputPrice}/M output)</p>`;
    } else if (pricing.isDynamic) {
        pricingNote = `<p style="color: #38a169; margin-top: 12px;">✓ <strong>Standard pricing:</strong> This estimate uses ${pricing.name}'s standard pricing ($${inputPrice}/M input, $${outputPrice}/M output)</p>`;
    }

    const inputCost = (estimatedInputTokens / 1000000) * inputPrice;
    const outputCost = (estimatedOutputTokens / 1000000) * outputPrice;
    const totalCost = inputCost + outputCost;

    // Calculate token breakdown
    const promptTokens = promptTokensPerRequest - ESTIMATED_TOKENS_PER_TRANSCRIPT.input;
    const contextTokensTotal = totalTranscripts * ESTIMATED_TOKENS_PER_TRANSCRIPT.input;
    const promptTokensTotal = totalTranscripts * promptTokens;

    // Display estimate
    const estimateHTML = `
        <p><strong>Transcript Count:</strong> ${transcriptCount} (${seriesCount} series × 4 episodes + ${singlesCount} singles = ${totalTranscripts} total)</p>
        <p><strong>Input Token Breakdown:</strong><br>
           &nbsp;&nbsp;• Prompt: ${formatTokens(promptTokensTotal)}<br>
           &nbsp;&nbsp;• Context/Combos: ${formatTokens(contextTokensTotal)}<br>
           &nbsp;&nbsp;• Total: ${formatTokens(estimatedInputTokens)}</p>
        <p><strong>Estimated Tokens:</strong> ${formatTokens(estimatedInputTokens)} input + ${formatTokens(estimatedOutputTokens)} output = ${formatTokens(estimatedInputTokens + estimatedOutputTokens)} total</p>
        <p><strong>Estimated Cost:</strong> <strong>${formatCost(totalCost)}</strong> USD<br>
           <span style="font-size: 11px; color: #718096;">(Input: ${formatCost(inputCost)} + Output: ${formatCost(outputCost)})</span></p>
        ${pricingNote}
        <p style="font-size: 12px; margin-top: 12px; color: #718096;">
            💡 <em>Actual cost may vary based on prompt length and model response length. This is an estimate.</em>
        </p>
    `;

    estimateDetails.innerHTML = estimateHTML;

    // Show/hide estimate based on whether we have valid input
    if (transcriptCount > 0) {
        costEstimate.classList.remove('hidden');
    }
}

// Model selection functions
function updateModelInfo() {
    const selectedModel = modelSelect.value;
    const info = modelData[selectedModel];

    if (info) {
        modelInfo.innerHTML = `
            <strong>${info.name}</strong><br>
            Speed: ${info.speed} | Quality: ${info.quality} | Cost: ${info.cost}<br>
            ${info.description}
        `;
    }

    // Update cost estimate when model changes
    estimateCost();
}

function saveModelPreference(modelId) {
    localStorage.setItem('selectedTranscriptModel', modelId);
}

function loadModelPreference() {
    const saved = localStorage.getItem('selectedTranscriptModel');
    if (saved && modelData[saved]) {
        modelSelect.value = saved;
        updateModelInfo();
    } else {
        // Default to Sonnet 4.5 if no preference saved
        modelSelect.value = 'claude-sonnet-4-5-20250929';
        updateModelInfo();
    }

    // Show initial cost estimate
    estimateCost();
}

// Initialize model preference on page load
loadModelPreference();

// Add event listener for model selection change
modelSelect.addEventListener('change', () => {
    updateModelInfo();
    saveModelPreference(modelSelect.value);
});

// Add event listener for transcript count change
document.getElementById('transcriptCount').addEventListener('change', () => {
    estimateCost();
});

document.getElementById('transcriptCount').addEventListener('input', () => {
    estimateCost();
});

// Add event listener for prompt text change
document.getElementById('prompt').addEventListener('change', () => {
    estimateCost();
});

document.getElementById('prompt').addEventListener('input', () => {
    estimateCost();
});

// Add toggle functionality for cost estimate panel
costEstimateToggle.addEventListener('click', () => {
    const isExpanded = costEstimateToggle.classList.contains('expanded');

    if (isExpanded) {
        // Close
        costEstimateToggle.classList.remove('expanded');
        estimateDetails.classList.remove('expanded');
    } else {
        // Open
        costEstimateToggle.classList.add('expanded');
        estimateDetails.classList.add('expanded');
    }
});

// Add event listeners for control buttons
pauseBtn.addEventListener('click', async () => {
    if (!currentJobId || jobState !== 'running') return;

    if (confirmAction('Are you sure you want to pause generation? You can resume it later.')) {
        await pauseJob();
    }
});

resumeBtn.addEventListener('click', async () => {
    if (!currentJobId || jobState !== 'paused') return;
    await resumeJob();
});

cancelBtn.addEventListener('click', async () => {
    if (!currentJobId) return;

    if (confirmAction('Are you sure you want to cancel generation? Downloaded transcripts will be saved for partial download.')) {
        await cancelJob();
    }
});

startNewBtn.addEventListener('click', () => {
    // Reset UI and allow new generation
    cancelledContainer.classList.add('hidden');
    form.classList.remove('hidden');
    generateBtn.disabled = false;
    currentJobId = null;
    jobState = 'idle';
});

downloadPartialBtn.addEventListener('click', () => {
    if (currentJobId) {
        window.location.href = `/download-partial/${currentJobId}`;
    }
});

async function pauseJob() {
    try {
        const response = await fetch(`/pause/${currentJobId}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to pause job');
        }

        const result = await response.json();
        jobState = 'paused';
        updateControlButtons();
        addStatusLog('Generation paused. Click Resume to continue.');
    } catch (error) {
        console.error('Error pausing job:', error);
        addStatusLog(`Error pausing: ${error.message}`, 'error');
    }
}

async function resumeJob() {
    try {
        const response = await fetch(`/resume/${currentJobId}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to resume job');
        }

        const result = await response.json();
        jobState = 'running';
        updateControlButtons();
        addStatusLog('Generation resumed.');
    } catch (error) {
        console.error('Error resuming job:', error);
        addStatusLog(`Error resuming: ${error.message}`, 'error');
    }
}

async function cancelJob() {
    try {
        const response = await fetch(`/cancel/${currentJobId}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to cancel job');
        }

        const result = await response.json();
        jobState = 'cancelled';
        updateControlButtons();
        addStatusLog('Generation cancelled.');

        // Show cancelled container with partial results
        setTimeout(() => {
            progressContainer.classList.add('hidden');
            cancelledContainer.classList.remove('hidden');
            cancelledMessage.textContent = `Generation was cancelled. ${result.stats.completedCount} out of ${result.stats.totalCount} transcripts were completed.`;
            cancelledStats.innerHTML = `
                <p>Completed: ${result.stats.completedCount} / ${result.stats.totalCount}</p>
            `;
        }, 500);
    } catch (error) {
        console.error('Error cancelling job:', error);
        addStatusLog(`Error cancelling: ${error.message}`, 'error');
    }
}

function updateControlButtons() {
    if (jobState === 'running') {
        pauseBtn.classList.remove('hidden');
        resumeBtn.classList.add('hidden');
        cancelBtn.classList.remove('hidden');
    } else if (jobState === 'paused') {
        pauseBtn.classList.add('hidden');
        resumeBtn.classList.remove('hidden');
        cancelBtn.classList.remove('hidden');
    } else {
        pauseBtn.classList.add('hidden');
        resumeBtn.classList.add('hidden');
        cancelBtn.classList.add('hidden');
    }
}

function addStatusLog(message, type = 'info') {
    const statusItem = document.createElement('div');
    statusItem.className = `status-item ${type}`;
    const icon = type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : 'ℹ️');
    statusItem.textContent = `${icon} ${message}`;
    statusLog.appendChild(statusItem);
    statusLog.scrollTop = statusLog.scrollHeight;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Reset UI
    progressContainer.classList.remove('hidden');
    resultContainer.classList.add('hidden');
    cancelledContainer.classList.add('hidden');
    errorContainer.classList.add('hidden');
    statusLog.innerHTML = '';
    progressBar.style.width = '0%';
    jobStats.classList.remove('hidden');
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    jobState = 'running';

    // Generate a job ID based on timestamp
    currentJobId = Date.now().toString();

    const formData = {
        apiKey: document.getElementById('apiKey').value,
        transcriptCount: parseInt(document.getElementById('transcriptCount').value),
        prompt: document.getElementById('prompt').value,
        jobId: currentJobId,
        model: modelSelect.value
    };

    totalCount.textContent = formData.transcriptCount;
    completedCount.textContent = '0';

    try {
        const response = await fetch('/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Generation failed');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        updateControlButtons();

        while (true) {
            // Check if job was cancelled
            if (jobState === 'cancelled') {
                reader.cancel();
                break;
            }

            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));

                    if (data.type === 'status') {
                        progressText.textContent = data.message;
                        addStatusLog(data.message);
                    } else if (data.type === 'progress') {
                        const percentage = (data.current / data.total) * 100;
                        progressBar.style.width = percentage + '%';

                        let progressMsg = `Generated ${data.current} of ${data.total} transcripts...`;
                        if (data.tokens && data.cost) {
                            progressMsg += ` | ${data.tokens} tokens | ${data.cost}`;
                        }
                        progressText.textContent = progressMsg;
                        completedCount.textContent = data.current;

                        const statusItem = document.createElement('div');
                        statusItem.className = 'status-item';
                        const context = data.context ? ` (${data.context})` : '';
                        let statusMsg = `✓ Generated: ${data.filename}${context}`;
                        if (data.tokens && data.cost) {
                            statusMsg += ` | ${data.tokens} | ${data.cost}`;
                        }
                        statusItem.textContent = statusMsg;
                        statusLog.appendChild(statusItem);
                        statusLog.scrollTop = statusLog.scrollHeight;
                    } else if (data.type === 'complete') {
                        progressBar.style.width = '100%';
                        progressText.textContent = 'Creating ZIP file...';
                        downloadUrl = data.downloadUrl;
                        jobState = 'completed';
                        updateControlButtons();

                        // Add final cost summary to status log
                        if (data.stats && data.stats.cost) {
                            const costSummary = document.createElement('div');
                            costSummary.className = 'status-item success';
                            const costData = data.stats.cost;
                            costSummary.innerHTML = `
                                <strong>💰 Cost Summary</strong><br>
                                Input Tokens: ${costData.inputTokens.toLocaleString()} | Output Tokens: ${costData.outputTokens.toLocaleString()} | Total: ${costData.formattedTokens}<br>
                                Input Cost: $${costData.inputCost.toFixed(6)} | Output Cost: $${costData.outputCost.toFixed(6)} | Total: <strong>${costData.formattedCost}</strong>
                            `;
                            statusLog.appendChild(costSummary);
                            statusLog.scrollTop = statusLog.scrollHeight;
                        }

                        setTimeout(() => {
                            progressContainer.classList.add('hidden');
                            resultContainer.classList.remove('hidden');
                        }, 500);
                    } else if (data.type === 'error') {
                        throw new Error(data.message);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error:', error);
        if (jobState !== 'cancelled') {
            progressContainer.classList.add('hidden');
            errorContainer.classList.remove('hidden');
            errorMessage.textContent = error.message;
            jobState = 'error';
        }
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Transcripts';
        updateControlButtons();
    }
});

downloadBtn.addEventListener('click', () => {
    if (downloadUrl) {
        window.location.href = downloadUrl;
    }
});