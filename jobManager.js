/**
 * Job Manager - Handles state management for transcript generation jobs
 * Supports pause, resume, and cancel operations
 */

const fs = require('fs');
const path = require('path');

class JobManager {
    constructor() {
        this.jobs = new Map();
        this.JOBS_DIR = path.join(__dirname, 'jobs');

        // Ensure jobs directory exists
        if (!fs.existsSync(this.JOBS_DIR)) {
            fs.mkdirSync(this.JOBS_DIR, { recursive: true });
        }
    }

    /**
     * Create a new job
     */
    createJob(jobId, transcriptCount, combos) {
        const job = {
            id: jobId,
            state: 'running', // running, paused, cancelled, completed
            startTime: Date.now(),
            transcriptCount: transcriptCount,
            combos: combos,
            completedTranscripts: [],
            inProgressIndex: 0,
            pausedAt: null,
            cancelledAt: null,
            completedAt: null,
            abortController: new AbortController()
        };

        this.jobs.set(jobId, job);
        this.saveJobState(jobId);
        return job;
    }

    /**
     * Get job by ID
     */
    getJob(jobId) {
        return this.jobs.get(jobId);
    }

    /**
     * Update job progress
     */
    updateProgress(jobId, transcriptIndex, fileName) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        job.inProgressIndex = transcriptIndex;
        job.completedTranscripts.push({
            index: transcriptIndex,
            fileName: fileName,
            completedAt: new Date().toISOString()
        });

        this.saveJobState(jobId);
    }

    /**
     * Pause a job
     */
    pauseJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        if (job.state !== 'running') {
            throw new Error(`Cannot pause job in state: ${job.state}`);
        }

        job.state = 'paused';
        job.pausedAt = Date.now();
        this.saveJobState(jobId);

        return job;
    }

    /**
     * Resume a paused job
     */
    resumeJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        if (job.state !== 'paused') {
            throw new Error(`Cannot resume job in state: ${job.state}`);
        }

        job.state = 'running';
        job.pausedAt = null;
        // Create new abort controller for resumed job
        job.abortController = new AbortController();
        this.saveJobState(jobId);

        return job;
    }

    /**
     * Cancel a job
     */
    cancelJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        job.state = 'cancelled';
        job.cancelledAt = Date.now();
        // Abort any pending API requests
        job.abortController.abort();
        this.saveJobState(jobId);

        return job;
    }

    /**
     * Complete a job
     */
    completeJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        job.state = 'completed';
        job.completedAt = Date.now();
        this.saveJobState(jobId);

        return job;
    }

    /**
     * Get job stats
     */
    getJobStats(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            return null;
        }

        const completedCount = job.completedTranscripts.length;
        const pendingCount = job.transcriptCount - completedCount;
        const elapsedTime = Date.now() - job.startTime;
        const estimatedTimeRemaining = pendingCount > 0
            ? Math.round((elapsedTime / completedCount) * pendingCount)
            : 0;

        return {
            id: jobId,
            state: job.state,
            completedCount: completedCount,
            totalCount: job.transcriptCount,
            pendingCount: pendingCount,
            percentComplete: Math.round((completedCount / job.transcriptCount) * 100),
            elapsedTime: elapsedTime,
            estimatedTimeRemaining: estimatedTimeRemaining,
            startTime: job.startTime,
            pausedAt: job.pausedAt,
            cancelledAt: job.cancelledAt,
            completedAt: job.completedAt
        };
    }

    /**
     * Save job state to disk for recovery
     */
    saveJobState(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        const stateFile = path.join(this.JOBS_DIR, `${jobId}.json`);
        const stateToPersist = {
            id: job.id,
            state: job.state,
            startTime: job.startTime,
            transcriptCount: job.transcriptCount,
            inProgressIndex: job.inProgressIndex,
            completedTranscripts: job.completedTranscripts,
            pausedAt: job.pausedAt,
            cancelledAt: job.cancelledAt,
            completedAt: job.completedAt
        };

        fs.writeFileSync(stateFile, JSON.stringify(stateToPersist, null, 2));
    }

    /**
     * Load job state from disk (for recovery)
     */
    loadJobState(jobId) {
        const stateFile = path.join(this.JOBS_DIR, `${jobId}.json`);
        if (!fs.existsSync(stateFile)) {
            return null;
        }

        try {
            const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            return state;
        } catch (error) {
            console.error(`Error loading job state for ${jobId}:`, error);
            return null;
        }
    }

    /**
     * Clean up job files
     */
    cleanupJob(jobId) {
        const stateFile = path.join(this.JOBS_DIR, `${jobId}.json`);
        if (fs.existsSync(stateFile)) {
            fs.unlinkSync(stateFile);
        }

        // Remove from in-memory cache
        this.jobs.delete(jobId);
    }

    /**
     * Get abort signal for a job (to pass to fetch calls)
     */
    getAbortSignal(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        return job.abortController.signal;
    }
}

module.exports = new JobManager();
