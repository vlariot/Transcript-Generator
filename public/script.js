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

let downloadUrl = null;

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
                        progressText.textContent = data.message;

                        const statusItem = document.createElement('div');
                        statusItem.className = 'status-item';
                        statusItem.textContent = `ℹ ${data.message}`;
                        statusLog.appendChild(statusItem);
                        statusLog.scrollTop = statusLog.scrollHeight;
                    } else if (data.type === 'progress') {
                        const percentage = (data.current / data.total) * 100;
                        progressBar.style.width = percentage + '%';
                        progressText.textContent = `Generated ${data.current} of ${data.total} transcripts...`;

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
