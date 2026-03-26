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

let db: SQLite.SQLiteDatabase | null = null;
let setupPromise: Promise<void> | null = null;

const ensureDb = async () => {
    await initDatabase();
    if (!db) throw new Error('Database failed to initialize');
    return db;
};

export const initDatabase = async () => {
    if (setupPromise) return setupPromise;

    setupPromise = (async () => {
        try {
            const database = await SQLite.openDatabaseAsync('medicine.db');
            db = database;

            await database.execAsync(`
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
                await database.execAsync('ALTER TABLE stock ADD COLUMN refillReminderTime TEXT;');
            } catch (e) {
                // Column already exists, ignore error
            }
        } catch (error) {
            console.error('Database setup error:', error);
            setupPromise = null; // Allow retry
            throw error;
        }
    })();

    return setupPromise;
};

export const addMedication = async (med: Omit<Medication, 'id'>) => {
    const database = await ensureDb();
    const result = await database.runAsync(
        'INSERT INTO medications (name, dosage, frequency, time, icon, color, stockEnabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [med.name, med.dosage, med.frequency, med.time, med.icon, med.color, med.stockEnabled ? 1 : 0]
    );
    return result.lastInsertRowId;
};

export const getMedications = async (): Promise<Medication[]> => {
    const database = await ensureDb();
    const result = await database.getAllAsync<Medication>('SELECT * FROM medications');
    return result.map(m => ({ ...m, stockEnabled: Boolean(m.stockEnabled) }));
};

export const getMedicationById = async (id: number): Promise<Medication | null> => {
    const database = await ensureDb();
    const med = await database.getFirstAsync<Medication>('SELECT * FROM medications WHERE id = ?', [id]);
    return med ? { ...med, stockEnabled: Boolean(med.stockEnabled) } : null;
};

export const deleteMedication = async (id: number) => {
    const database = await ensureDb();
    await database.runAsync('DELETE FROM medications WHERE id = ?', [id]);
    await database.runAsync('DELETE FROM logs WHERE medicationId = ?', [id]);
    await database.runAsync('DELETE FROM stock WHERE medicationId = ?', [id]);
    await database.runAsync('DELETE FROM stock_batches WHERE medicationId = ?', [id]);
};

export const updateMedication = async (id: number, med: Omit<Medication, 'id'>) => {
    const database = await ensureDb();
    await database.runAsync(
        'UPDATE medications SET name = ?, dosage = ?, frequency = ?, time = ?, icon = ?, color = ?, stockEnabled = ? WHERE id = ?',
        [med.name, med.dosage, med.frequency, med.time, med.icon, med.color, med.stockEnabled ? 1 : 0, id]
    );
};

export const toggleStockTracking = async (id: number, enabled: boolean) => {
    const database = await ensureDb();
    await database.runAsync('UPDATE medications SET stockEnabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
    if (!enabled) {
        await database.runAsync('DELETE FROM stock WHERE medicationId = ?', [id]);
        await database.runAsync('DELETE FROM stock_batches WHERE medicationId = ?', [id]);
    } else {
        // Initialize with 0 qty and 0 threshold
        await database.runAsync('INSERT OR IGNORE INTO stock (medicationId, quantity, threshold) VALUES (?, 0, 0)', [id]);
    }
};

export const logMedication = async (log: Omit<MedicationLog, 'id'>) => {
    const database = await ensureDb();
    // Check if a log already exists for this medication and date
    const existingLog = await database.getFirstAsync<MedicationLog>(
        'SELECT * FROM logs WHERE medicationId = ? AND date = ?',
        [log.medicationId, log.date]
    );

    if (existingLog) {
        if (existingLog.status === log.status) {
            // No status change, just update the time if needed (optional)
            await database.runAsync(
                'UPDATE logs SET time = ? WHERE id = ?',
                [log.time, existingLog.id]
            );
            return;
        }

        // Status changed
        if (existingLog.status === 'taken' && log.status === 'skipped') {
            // Mark as skipped: Give back stock
            const med = await database.getFirstAsync<{ stockEnabled: number }>('SELECT stockEnabled FROM medications WHERE id = ?', [log.medicationId]);
            if (med?.stockEnabled) {
                await database.runAsync('UPDATE stock SET quantity = quantity + 1 WHERE medicationId = ?', [log.medicationId]);
                const batches = await database.getAllAsync<{ id: number }>('SELECT id FROM stock_batches WHERE medicationId = ? ORDER BY expiryDate DESC LIMIT 1', [log.medicationId]);
                if (batches.length > 0) {
                    await database.runAsync('UPDATE stock_batches SET quantity = quantity + 1 WHERE id = ?', [batches[0].id]);
                }
            }
        } else if (existingLog.status === 'skipped' && log.status === 'taken') {
            // Mark as taken: Deduct stock
            const med = await database.getFirstAsync<{ name: string; stockEnabled: number }>('SELECT name, stockEnabled FROM medications WHERE id = ?', [log.medicationId]);
            if (med?.stockEnabled) {
                await database.runAsync('UPDATE stock SET quantity = quantity - 1 WHERE medicationId = ?', [log.medicationId]);
                const batches = await database.getAllAsync<{ id: number; quantity: number }>('SELECT id, quantity FROM stock_batches WHERE medicationId = ? AND quantity > 0 ORDER BY expiryDate ASC', [log.medicationId]);
                if (batches.length > 0) {
                    await database.runAsync('UPDATE stock_batches SET quantity = quantity - 1 WHERE id = ?', [batches[0].id]);
                }
                const stock = await database.getFirstAsync<{ quantity: number; threshold: number }>('SELECT quantity, threshold FROM stock WHERE medicationId = ?', [log.medicationId]);
                if (stock && stock.quantity <= stock.threshold) {
                    await scheduleLowStockNotification(med.name, stock.quantity);
                }
            }
        }

        await database.runAsync(
            'UPDATE logs SET status = ?, time = ? WHERE id = ?',
            [log.status, log.time, existingLog.id]
        );
    } else {
        // New log
        await database.runAsync(
            'INSERT INTO logs (medicationId, date, time, status) VALUES (?, ?, ?, ?)',
            [log.medicationId, log.date, log.time, log.status]
        );

        if (log.status === 'taken') {
            const med = await database.getFirstAsync<{ name: string; stockEnabled: number }>('SELECT name, stockEnabled FROM medications WHERE id = ?', [log.medicationId]);
            if (med?.stockEnabled) {
                await database.runAsync('UPDATE stock SET quantity = quantity - 1 WHERE medicationId = ?', [log.medicationId]);
                const batches = await database.getAllAsync<{ id: number; quantity: number }>('SELECT id, quantity FROM stock_batches WHERE medicationId = ? AND quantity > 0 ORDER BY expiryDate ASC', [log.medicationId]);
                if (batches.length > 0) {
                    await database.runAsync('UPDATE stock_batches SET quantity = quantity - 1 WHERE id = ?', [batches[0].id]);
                }
                const stock = await database.getFirstAsync<{ quantity: number; threshold: number }>('SELECT quantity, threshold FROM stock WHERE medicationId = ?', [log.medicationId]);
                if (stock && stock.quantity <= stock.threshold) {
                    await scheduleLowStockNotification(med.name, stock.quantity);
                }
            }
        }
    }
};

export const getLogs = async (date: string): Promise<MedicationLog[]> => {
    const database = await ensureDb();
    return await database.getAllAsync<MedicationLog>('SELECT * FROM logs WHERE date = ? ORDER BY time DESC', [date]);
};

export const deleteLog = async (logId: number) => {
    const database = await ensureDb();
    const log = await database.getFirstAsync<MedicationLog>('SELECT * FROM logs WHERE id = ?', [logId]);
    if (log && log.status === 'taken') {
        const med = await database.getFirstAsync<{ stockEnabled: number }>('SELECT stockEnabled FROM medications WHERE id = ?', [log.medicationId]);
        if (med?.stockEnabled) {
            await database.runAsync('UPDATE stock SET quantity = quantity + 1 WHERE medicationId = ?', [log.medicationId]);

            // Add back to the batch with latest expiry date or just the most recent one we deducted from.
            const batches = await database.getAllAsync<{ id: number }>('SELECT id FROM stock_batches WHERE medicationId = ? ORDER BY expiryDate DESC LIMIT 1', [log.medicationId]);
            if (batches.length > 0) {
                await database.runAsync('UPDATE stock_batches SET quantity = quantity + 1 WHERE id = ?', [batches[0].id]);
            }
        }
    }
    await database.runAsync('DELETE FROM logs WHERE id = ?', [logId]);
};

export const updateStock = async (medicationId: number, quantity: number, threshold: number, refillReminderTime?: string) => {
    const database = await ensureDb();
    await database.runAsync(
        'INSERT INTO stock (medicationId, quantity, threshold, refillReminderTime) VALUES (?, ?, ?, ?) ON CONFLICT(medicationId) DO UPDATE SET quantity = ?, threshold = ?, refillReminderTime = ?',
        [medicationId, quantity, threshold, refillReminderTime || null, quantity, threshold, refillReminderTime || null]
    );

    // Check if new stock is low and trigger notification immediately
    if (quantity <= threshold) {
        const med = await database.getFirstAsync<{ name: string }>('SELECT name FROM medications WHERE id = ?', [medicationId]);
        if (med) {
            await scheduleLowStockNotification(med.name, quantity);
        }
    }
};

export const getStock = async (): Promise<(Stock & { name: string })[]> => {
    const database = await ensureDb();
    return await database.getAllAsync<(Stock & { name: string })>(
        'SELECT stock.*, medications.name FROM stock JOIN medications ON stock.medicationId = medications.id'
    );
};

export const getLogsByRange = async (startDate: string, endDate: string): Promise<MedicationLog[]> => {
    const database = await ensureDb();
    return await database.getAllAsync<MedicationLog>(
        'SELECT * FROM logs WHERE date >= ? AND date <= ? ORDER BY date DESC, time DESC',
        [startDate, endDate]
    );
};

export const refillStock = async (medicationId: number, amount: number, expiryDate: string) => {
    const database = await ensureDb();
    await database.runAsync('UPDATE stock SET quantity = quantity + ? WHERE medicationId = ?', [amount, medicationId]);
    await database.runAsync('INSERT INTO stock_batches (medicationId, quantity, expiryDate) VALUES (?, ?, ?)', [medicationId, amount, expiryDate]);
};

export const getBatches = async (medicationId: number): Promise<StockBatch[]> => {
    const database = await ensureDb();
    return await database.getAllAsync<StockBatch>('SELECT * FROM stock_batches WHERE medicationId = ? AND quantity > 0 ORDER BY expiryDate ASC', [medicationId]);
};

export const getAllBatches = async (): Promise<StockBatch[]> => {
    const database = await ensureDb();
    return await database.getAllAsync<StockBatch>('SELECT * FROM stock_batches WHERE quantity > 0 ORDER BY expiryDate ASC');
};
