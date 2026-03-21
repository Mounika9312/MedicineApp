import * as SQLite from 'expo-sqlite';
import { scheduleLowStockNotification } from './notifications';

export interface Medication {
    id: number;
    name: string;
    dosage: string;
    frequency: string;
    time: string;
    icon: string;
    color: string;
    stockEnabled: boolean;
}

export interface MedicationLog {
    id: number;
    medicationId: number;
    date: string;
    time: string;
    status: 'taken' | 'skipped';
}

export interface Stock {
    id: number;
    medicationId: number;
    quantity: number;
    threshold: number;
    refillReminderTime?: string;
}

export interface StockBatch {
    id: number;
    medicationId: number;
    quantity: number;
    expiryDate: string;
}

let db: SQLite.SQLiteDatabase;

export const initDatabase = async () => {
    db = await SQLite.openDatabaseAsync('medicine.db');

    await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL,
      time TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      stockEnabled INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicationId INTEGER,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (medicationId) REFERENCES medications (id)
    );
    CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicationId INTEGER UNIQUE,
      quantity INTEGER DEFAULT 0,
      threshold INTEGER DEFAULT 0,
      refillReminderTime TEXT,
      FOREIGN KEY (medicationId) REFERENCES medications (id)
    );
    CREATE TABLE IF NOT EXISTS stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicationId INTEGER,
      quantity INTEGER,
      expiryDate TEXT NOT NULL,
      FOREIGN KEY (medicationId) REFERENCES medications (id)
    );
  `);

    // Migration to add refillReminderTime if it doesn't exist
    try {
        await db.execAsync('ALTER TABLE stock ADD COLUMN refillReminderTime TEXT;');
    } catch (e) {
        // Column already exists, ignore error
    }
};

export const addMedication = async (med: Omit<Medication, 'id'>) => {
    const result = await db.runAsync(
        'INSERT INTO medications (name, dosage, frequency, time, icon, color, stockEnabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [med.name, med.dosage, med.frequency, med.time, med.icon, med.color, med.stockEnabled ? 1 : 0]
    );
    return result.lastInsertRowId;
};

export const getMedications = async (): Promise<Medication[]> => {
    const result = await db.getAllAsync<Medication>('SELECT * FROM medications');
    return result.map(m => ({ ...m, stockEnabled: Boolean(m.stockEnabled) }));
};

export const getMedicationById = async (id: number): Promise<Medication | null> => {
    const med = await db.getFirstAsync<Medication>('SELECT * FROM medications WHERE id = ?', [id]);
    return med ? { ...med, stockEnabled: Boolean(med.stockEnabled) } : null;
};

export const deleteMedication = async (id: number) => {
    await db.runAsync('DELETE FROM medications WHERE id = ?', [id]);
    await db.runAsync('DELETE FROM logs WHERE medicationId = ?', [id]);
    await db.runAsync('DELETE FROM stock WHERE medicationId = ?', [id]);
    await db.runAsync('DELETE FROM stock_batches WHERE medicationId = ?', [id]);
};

export const updateMedication = async (id: number, med: Omit<Medication, 'id'>) => {
    await db.runAsync(
        'UPDATE medications SET name = ?, dosage = ?, frequency = ?, time = ?, icon = ?, color = ?, stockEnabled = ? WHERE id = ?',
        [med.name, med.dosage, med.frequency, med.time, med.icon, med.color, med.stockEnabled ? 1 : 0, id]
    );
};

export const logMedication = async (log: Omit<MedicationLog, 'id'>) => {
    await db.runAsync(
        'INSERT INTO logs (medicationId, date, time, status) VALUES (?, ?, ?, ?)',
        [log.medicationId, log.date, log.time, log.status]
    );

    // Update stock if enabled
    if (log.status === 'taken') {
        const med = await db.getFirstAsync<{ name: string; stockEnabled: number }>('SELECT name, stockEnabled FROM medications WHERE id = ?', [log.medicationId]);
        if (med?.stockEnabled) {
            await db.runAsync('UPDATE stock SET quantity = quantity - 1 WHERE medicationId = ?', [log.medicationId]);

            // Deduct from nearest expiring batch first
            const batches = await db.getAllAsync<{ id: number; quantity: number }>('SELECT id, quantity FROM stock_batches WHERE medicationId = ? AND quantity > 0 ORDER BY expiryDate ASC', [log.medicationId]);
            if (batches.length > 0) {
                await db.runAsync('UPDATE stock_batches SET quantity = quantity - 1 WHERE id = ?', [batches[0].id]);
            }

            // Check for low stock
            const stock = await db.getFirstAsync<{ quantity: number; threshold: number }>('SELECT quantity, threshold FROM stock WHERE medicationId = ?', [log.medicationId]);
            if (stock && stock.quantity <= stock.threshold) {
                await scheduleLowStockNotification(med.name, stock.quantity);
            }
        }
    }
};

export const getLogs = async (date: string): Promise<MedicationLog[]> => {
    return await db.getAllAsync<MedicationLog>('SELECT * FROM logs WHERE date = ? ORDER BY time DESC', [date]);
};

export const deleteLog = async (logId: number) => {
    const log = await db.getFirstAsync<MedicationLog>('SELECT * FROM logs WHERE id = ?', [logId]);
    if (log && log.status === 'taken') {
        const med = await db.getFirstAsync<{ stockEnabled: number }>('SELECT stockEnabled FROM medications WHERE id = ?', [log.medicationId]);
        if (med?.stockEnabled) {
            await db.runAsync('UPDATE stock SET quantity = quantity + 1 WHERE medicationId = ?', [log.medicationId]);

            // Add back to the batch with latest expiry date or just the most recent one we deducted from.
            const batches = await db.getAllAsync<{ id: number }>('SELECT id FROM stock_batches WHERE medicationId = ? ORDER BY expiryDate DESC LIMIT 1', [log.medicationId]);
            if (batches.length > 0) {
                await db.runAsync('UPDATE stock_batches SET quantity = quantity + 1 WHERE id = ?', [batches[0].id]);
            }
        }
    }
    await db.runAsync('DELETE FROM logs WHERE id = ?', [logId]);
};

export const updateStock = async (medicationId: number, quantity: number, threshold: number, refillReminderTime?: string) => {
    await db.runAsync(
        'INSERT INTO stock (medicationId, quantity, threshold, refillReminderTime) VALUES (?, ?, ?, ?) ON CONFLICT(medicationId) DO UPDATE SET quantity = ?, threshold = ?, refillReminderTime = ?',
        [medicationId, quantity, threshold, refillReminderTime || null, quantity, threshold, refillReminderTime || null]
    );

    // Check if new stock is low and trigger notification immediately
    if (quantity <= threshold) {
        const med = await db.getFirstAsync<{ name: string }>('SELECT name FROM medications WHERE id = ?', [medicationId]);
        if (med) {
            await scheduleLowStockNotification(med.name, quantity);
        }
    }
};

export const getStock = async (): Promise<(Stock & { name: string })[]> => {
    return await db.getAllAsync<(Stock & { name: string })>(
        'SELECT stock.*, medications.name FROM stock JOIN medications ON stock.medicationId = medications.id'
    );
};

export const getLogsByRange = async (startDate: string, endDate: string): Promise<MedicationLog[]> => {
    return await db.getAllAsync<MedicationLog>(
        'SELECT * FROM logs WHERE date >= ? AND date <= ? ORDER BY date DESC, time DESC',
        [startDate, endDate]
    );
};

export const refillStock = async (medicationId: number, amount: number, expiryDate: string) => {
    await db.runAsync('UPDATE stock SET quantity = quantity + ? WHERE medicationId = ?', [amount, medicationId]);
    await db.runAsync('INSERT INTO stock_batches (medicationId, quantity, expiryDate) VALUES (?, ?, ?)', [medicationId, amount, expiryDate]);
};

export const getBatches = async (medicationId: number): Promise<StockBatch[]> => {
    return await db.getAllAsync<StockBatch>('SELECT * FROM stock_batches WHERE medicationId = ? AND quantity > 0 ORDER BY expiryDate ASC', [medicationId]);
};

export const getAllBatches = async (): Promise<StockBatch[]> => {
    return await db.getAllAsync<StockBatch>('SELECT * FROM stock_batches WHERE quantity > 0 ORDER BY expiryDate ASC');
};
