import { Gauge } from 'prom-client';

const bufferSize = new Gauge({
  name: 'ruuvi_buffer_size',
  help: 'Current buffer size',
  labelNames: ['type'] // Influx or MariaDB buffer size
});

export class MessageBuffer<T> {
  private buffer: T[] = [];
  constructor(
    private readonly maxSize: number,
    private readonly flushFn: (data: T[]) => Promise<void>,
    private readonly type: string
  ) {}
  push(item: T) {
    this.buffer.push(item);
    bufferSize.set({ type: this.type }, this.buffer.length);
    if (this.buffer.length >= this.maxSize) {
      this.flush();
    }
  }

  async flush() {
    if (!this.buffer.length) return;
    const data = [...this.buffer];
    this.buffer = [];
    bufferSize.set({ type: this.type }, 0);
    await this.flushFn(data);
  }
}