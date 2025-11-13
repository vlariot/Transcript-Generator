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

let downloadUrl = null;
let currentJobId = null;
let jobState = 'idle'; // idle, running, paused, cancelled, completed

// Model information and metadata
const modelData = {
    'claude-3-5-sonnet-20241022': {
        name: 'Sonnet 3.5',
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
        name: 'Opus',
        speed: '🐌',
        quality: '⭐⭐⭐⭐⭐',
        cost: '💰💰💰💰',
        description: 'Premium quality but slowest. Best for when quality is paramount.'
    },
    'claude-3-5-haiku-20241022': {
        name: 'Haiku',
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
}

// Initialize model preference on page load
loadModelPreference();

// Add event listener for model selection change
modelSelect.addEventListener('change', () => {
    updateModelInfo();
    saveModelPreference(modelSelect.value);
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
                        progressText.textContent = `Generated ${data.current} of ${data.total} transcripts...`;
                        completedCount.textContent = data.current;

                        const statusItem = document.createElement('div');
                        statusItem.className = 'status-item';
                        const context = data.context ? ` (${data.context})` : '';
                        statusItem.textContent = `✓ Generated: ${data.filename}${context}`;
                        statusLog.appendChild(statusItem);
                        statusLog.scrollTop = statusLog.scrollHeight;
                    } else if (data.type === 'complete') {
                        progressBar.style.width = '100%';
                        progressText.textContent = 'Creating ZIP file...';
                        downloadUrl = data.downloadUrl;
                        jobState = 'completed';
                        updateControlButtons();

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