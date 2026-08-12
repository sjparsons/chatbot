import type { Response } from "express";

/**
 * Minimal Server-Sent Events writer.
 *
 * Wire format is `event: <name>\ndata: <json>\n\n`. Data is always JSON so the
 * client can parse every event the same way.
 */
export class SseStream {
  private closed = false;

  constructor(private readonly res: Response) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx and friends from buffering the stream.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
  }

  send(event: string, data: unknown): void {
    if (this.closed) return;
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Marks the stream dead without writing — for client disconnects. */
  markClosed(): void {
    this.closed = true;
  }
}
