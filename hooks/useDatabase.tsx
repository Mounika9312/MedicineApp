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
        setMedications(meds);
    };

    useEffect(() => {
        const setup = async () => {
            await initDatabase();
            await refreshData();
            setIsReady(true);
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
