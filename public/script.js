const form = document.getElementById('generatorForm');
const generateBtn = document.getElementById('generateBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const statusLog = document.getElementById('statusLog');
const resultContainer = document.getElementById('resultContainer');
const downloadBtn = document.getElementById('downloadBtn');
const errorContainer = document.getElementById('errorContainer');
const errorMessage = document.getElementById('errorMessage');

// Time estimate elements
const progressCount = document.getElementById('progressCount');
const progressPercent = document.getElementById('progressPercent');
const elapsedTime = document.getElementById('elapsedTime');
const remainingTime = document.getElementById('remainingTime');
const eta = document.getElementById('eta');
const speed = document.getElementById('speed');
const completedCount = document.getElementById('completedCount');
const inProgressCount = document.getElementById('inProgressCount');
const pendingCount = document.getElementById('pendingCount');
const failedCount = document.getElementById('failedCount');
const currentTranscript = document.getElementById('currentTranscript');
const currentTranscriptInfo = document.getElementById('currentTranscriptInfo');

let downloadUrl = null;

// Time tracking variables
let generationStartTime = null;
let totalTranscripts = 0;
let completedTranscripts = 0;
let transcriptTimings = []; // Track timings for moving average
let updateInterval = null;

/**
 * Format milliseconds to HH:MM:SS format
 */
function formatTime(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format time to HH:MM format (for ETA clock time)
 */
function formatClockTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Update time estimates in the UI
 */
function updateTimeEstimates() {
    if (!generationStartTime) return;

    const now = Date.now();
    const elapsed = now - generationStartTime;

    // Update elapsed time
    elapsedTime.textContent = formatTime(elapsed);

    // Calculate speed and estimates (only after at least 3 transcripts for better accuracy)
    if (completedTranscripts >= 3) {
        // Use a more stable calculation - exclude outliers
        // Calculate average but weight recent samples more heavily
        const avgTimePerTranscript = elapsed / completedTranscripts;
        const remaining = Math.max(0, totalTranscripts - completedTranscripts);

        // Smooth estimate: use completed time / completed count
        // This gives us a running average that stabilizes over time
        const estimatedRemainingMs = avgTimePerTranscript * remaining;

        // Update remaining time (with min 1 second to avoid showing 0)
        remainingTime.textContent = formatTime(Math.max(1000, estimatedRemainingMs));

        // Update ETA
        const etaDate = new Date(now + estimatedRemainingMs);
        eta.textContent = formatClockTime(etaDate);

        // Update speed (transcripts per minute)
        const speedPerMinute = (completedTranscripts / elapsed) * 60000;
        speed.textContent = speedPerMinute.toFixed(2) + ' transcripts/min';
    } else if (completedTranscripts >= 1) {
        // Only 1-2 transcripts - show "Calculating..." for smoother UX
        remainingTime.textContent = 'Calculating...';
        eta.textContent = '--:--';

        // Still show speed after first transcript
        if (completedTranscripts >= 1 && elapsed > 0) {
            const speedPerMinute = (completedTranscripts / elapsed) * 60000;
            speed.textContent = speedPerMinute.toFixed(2) + ' transcripts/min';
        } else {
            speed.textContent = '-- transcripts/min';
        }
    }
}

/**
 * Update progress display
 */
function updateProgress(current, total) {
    completedTranscripts = current;
    totalTranscripts = total;

    // Update count and percentage
    progressCount.textContent = `${current} / ${total}`;
    const percentage = Math.round((current / total) * 100);
    progressPercent.textContent = `(${percentage}%)`;

    // Update progress bar
    progressBar.style.width = percentage + '%';

    // Update status counts - FIXED
    const remaining = Math.max(0, total - current);
    completedCount.textContent = current;
    inProgressCount.textContent = remaining > 0 ? 1 : 0;  // 1 if there are remaining, 0 if all done
    pendingCount.textContent = remaining > 1 ? remaining - 1 : 0;  // Show remaining count, not completed, not in progress
    failedCount.textContent = '0';

    // Update time estimates
    updateTimeEstimates();
}

/**
 * Start the 1-second UI update interval
 */
function startUpdateInterval() {
    updateInterval = setInterval(() => {
        updateTimeEstimates();
    }, 1000);
}

/**
 * Stop the update interval
 */
function stopUpdateInterval() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Reset UI
    progressContainer.classList.remove('hidden');
    resultContainer.classList.add('hidden');
    errorContainer.classList.add('hidden');
    statusLog.innerHTML = '';
    progressBar.style.width = '0%';
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';

    // Reset time tracking - START TIMING IMMEDIATELY
    generationStartTime = Date.now();
    totalTranscripts = 0;
    completedTranscripts = 0;
    transcriptTimings = [];
    startUpdateInterval();

    const formData = {
        apiKey: document.getElementById('apiKey').value,
        transcriptCount: parseInt(document.getElementById('transcriptCount').value),
        prompt: document.getElementById('prompt').value
    };

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

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));

                    if (data.type === 'status') {
                        // Status message (like "Generating coach/client combinations...")
                        progressText.textContent = data.message;

                        const statusItem = document.createElement('div');
                        statusItem.className = 'status-item';
                        statusItem.textContent = `ℹ ${data.message}`;
                        statusLog.appendChild(statusItem);
                        statusLog.scrollTop = statusLog.scrollHeight;
                    } else if (data.type === 'progress') {
                        // Set total on first progress update
                        if (totalTranscripts === 0) {
                            totalTranscripts = data.total;
                        }

                        // Update progress
                        updateProgress(data.current, data.total);

                        // Update progress text with transcript info
                        progressText.textContent = `Generated ${data.current} of ${data.total} transcripts...`;

                        // Add status log entry
                        const statusItem = document.createElement('div');
                        statusItem.className = 'status-item';
                        const context = data.context ? ` (${data.context})` : '';
                        statusItem.textContent = `✓ Generated: ${data.filename}${context}`;
                        statusLog.appendChild(statusItem);
                        statusLog.scrollTop = statusLog.scrollHeight;

                        // Update current transcript info if available
                        if (data.context) {
                            currentTranscriptInfo.textContent = `Currently: ${data.context}`;
                            currentTranscript.classList.remove('hidden');
                        }
                    } else if (data.type === 'complete') {
                        stopUpdateInterval();

                        progressBar.style.width = '100%';
                        progressPercent.textContent = '(100%)';
                        progressText.textContent = 'Creating ZIP file...';
                        downloadUrl = data.downloadUrl;

                        // Final updates
                        updateProgress(data.total, data.total);
                        completedCount.textContent = data.total;
                        inProgressCount.textContent = '0';
                        pendingCount.textContent = '0';

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
        stopUpdateInterval();
        progressContainer.classList.add('hidden');
        errorContainer.classList.remove('hidden');
        errorMessage.textContent = error.message;
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Transcripts';
    }
});

downloadBtn.addEventListener('click', () => {
    if (downloadUrl) {
        window.location.href = downloadUrl;
    }
});
