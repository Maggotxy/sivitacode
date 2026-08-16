import type { SubprocessOutputRead, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'

/** Bounded host tail paired with an optional complete remote spill path. */
export class SshOutputReader implements SubprocessOutputReader {
  private chunks: Buffer[] = []
  private retained = 0
  private total = 0
  private completeSpill = true

  constructor(
    private readonly maximum: number,
    private readonly spillMaximum: number | undefined,
    private readonly spillPath: string | undefined,
  ) {}

  /**
   * Append raw transport bytes.
   * @param value - Stream bytes in delivery order.
   */
  push(value: Uint8Array): void {
    if (value.length === 0) return
    const chunk = Buffer.from(value)
    this.total += chunk.length
    if (this.spillMaximum !== undefined && this.total > this.spillMaximum) this.completeSpill = false
    this.chunks.push(chunk)
    this.retained += chunk.length
    while (this.retained > this.maximum) {
      const head = this.chunks[0] as Buffer
      const excess = this.retained - this.maximum
      if (head.length <= excess) {
        this.chunks.shift()
        this.retained -= head.length
      } else {
        this.chunks[0] = head.subarray(excess)
        this.retained -= excess
      }
    }
  }

  /** @inheritdoc */
  readFrom(fromByte: number): SubprocessOutputRead {
    const first = this.total - this.retained
    const lossy = fromByte < first
    const bytes = Buffer.concat(this.chunks, this.retained)
    const start = lossy ? 0 : Math.min(bytes.length, Math.max(0, fromByte - first))
    return {
      text: bytes.subarray(start).toString('utf8'),
      nextOffset: this.total,
      lossy,
      ...(lossy && this.completeSpill && this.spillPath !== undefined ? { spillPath: this.spillPath } : {}),
    }
  }
}
