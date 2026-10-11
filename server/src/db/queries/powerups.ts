import { getDb } from "../connection";

export interface PlayerPowerUp {
  powerup_type: string;
  quantity: number;
}

export function getPlayerPowerUps(address: string): PlayerPowerUp[] {
  return getDb()
    .prepare("SELECT powerup_type, quantity FROM powerups WHERE radix_address = ? AND quantity > 0")
    .all(address) as PlayerPowerUp[];
}

export function getPowerUpCount(address: string, type: string): number {
  const row = getDb()
    .prepare("SELECT quantity FROM powerups WHERE radix_address = ? AND powerup_type = ?")
    .get(address, type) as any;
  return row?.quantity ?? 0;
}

export function addPowerUp(address: string, type: string, quantity = 1): void {
  getDb()
    .prepare(`
      INSERT INTO powerups (radix_address, powerup_type, quantity) VALUES (?, ?, ?)
      ON CONFLICT(radix_address, powerup_type) DO UPDATE SET quantity = quantity + ?
    `)
    .run(address, type, quantity, quantity);
}

export function usePowerUp(address: string, type: string): boolean {
  const count = getPowerUpCount(address, type);
  if (count <= 0) return false;
  getDb()
    .prepare("UPDATE powerups SET quantity = quantity - 1 WHERE radix_address = ? AND powerup_type = ?")
    .run(address, type);
  return true;
}
