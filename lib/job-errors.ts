/**
 * Thrown by a job handler that cannot run yet (quiet hours, broadcast paused).
 * The cron puts the job back to pending at runAt without counting an attempt.
 */
export class JobRequeueError extends Error {
  constructor(
    public runAt: Date,
    reason: string
  ) {
    super(reason);
    this.name = "JobRequeueError";
  }
}
