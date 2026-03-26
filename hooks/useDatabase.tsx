import { getMedications, initDatabase, Medication } from '@/services/db';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface DatabaseContextType {
    isReady: boolean;
    medications: Medication[];
    refreshData: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);

export const DatabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isReady, setIsReady] = useState(false);
    const [medications, setMedications] = useState<Medication[]>([]);

    const refreshData = async () => {
        const meds = await getMedications();
        const { getStock } = await import('@/services/db');
        const stockItems = await getStock();
        setMedications(meds);

        // Sync notifications whenever data is refreshed, but don't let it crash the app
        try {
            const { rescheduleAllNotifications } = await import('@/services/notifications');
            await rescheduleAllNotifications(meds, stockItems);
        } catch (e) {
            console.warn('Silent notification sync failure:', e);
        }
    };

    useEffect(() => {
        const setup = async () => {
            try {
                await initDatabase();
                await refreshData();
                setIsReady(true);
            } catch (error) {
                console.error('Database setup failed:', error);
                // Even if it fails, we should probably set isReady to true 
                // but maybe we should show an error UI instead.
                // For now, let's just log it.
            }
        };
        setup();
    }, []);

    return (
        <DatabaseContext.Provider value={{ isReady, medications, refreshData }}>
            {children}
        </DatabaseContext.Provider>
    );
};

export const useDatabase = () => {
    const context = useContext(DatabaseContext);
    if (!context) {
        throw new Error('useDatabase must be used within a DatabaseProvider');
    }
    return context;
};
