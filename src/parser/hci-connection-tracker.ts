/**
 * Tracks active Bluetooth LE connections by handle,
 * mapping handles to peer address and role for ACL packet enrichment.
 */
export class HciConnectionTracker {
  private connections = new Map<number, { address: string; role: string }>();

  onConnectionComplete(handle: number, address: string, role: string): void {
    this.connections.set(handle, { address, role });
  }

  onDisconnection(handle: number): void {
    this.connections.delete(handle);
  }

  getConnection(handle: number): { address: string; role: string } | undefined {
    return this.connections.get(handle);
  }

  reset(): void {
    this.connections.clear();
  }
}
