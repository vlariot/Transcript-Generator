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

let downloadUrl = null;
let currentJobId = null;
let jobState = 'idle'; // idle, running, paused, cancelled, completed

// Confirmation dialog helper
function confirmAction(message) {
    return confirm(message);
}

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
        jobId: currentJobId
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