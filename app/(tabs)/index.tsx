import { useDatabase } from '@/hooks/useDatabase';
import { Medication, deleteLog, deleteMedication, getLogs, getStock, logMedication, getAllBatches, StockBatch } from '@/services/db';
import { getNotificationStatusAsync, setupNotificationsAsync } from '@/services/notifications';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';

export default function ScheduleScreen() {
    const { medications, isReady, refreshData } = useDatabase();
    const [logs, setLogs] = useState<any[]>([]);
    const [stockItems, setStockItems] = useState<any[]>([]);
    const [batches, setBatches] = useState<StockBatch[]>([]);
    const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
    const router = useRouter();
    const today = format(new Date(), 'yyyy-MM-dd');

    const lowStockMeds = medications.filter(med => {
        const stock = stockItems.find(s => s.medicationId === med.id);
        return stock && stock.quantity <= stock.threshold;
    });

    useEffect(() => {
        if (isReady) {
            checkPermissions();
        }
    }, [isReady]);

    const checkPermissions = async () => {
        const status = await getNotificationStatusAsync();
        setPermissionStatus(status);
    };

    const handleRequestPermissions = async () => {
        await setupNotificationsAsync();
        checkPermissions();
    };

    const loadData = useCallback(async () => {
        const [todayLogs, currentStock, allBatches] = await Promise.all([
            getLogs(today),
            getStock(),
            getAllBatches()
        ]);
        setLogs(todayLogs);
        setStockItems(currentStock);
        setBatches(allBatches);
    }, [today]);

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [loadData])
    );

    const handleMark = async (med: Medication, status: 'taken' | 'skipped') => {
        const existingLog = logs.find(l => l.medicationId === med.id);
        if (!existingLog) {
            await logMedication({
                medicationId: med.id,
                date: today,
                time: format(new Date(), 'HH:mm'),
                status,
            });
            loadData();
            refreshData(); // To update stock if taken
        }
    };

    const handleUndo = async (logId: number) => {
        await deleteLog(logId);
        loadData();
        refreshData();
    };

    const handleDelete = async (med: Medication) => {
        Alert.alert(
            'Delete Medication',
            `Are you sure you want to delete ${med.name}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        await deleteMedication(med.id);
                        refreshData();
                        loadData();
                    },
                },
            ]
        );
    };

    const handleEdit = (med: Medication) => {
        router.push({
            pathname: '/add-medicine',
            params: { id: med.id }
        });
    };

    const renderMedication = ({ item, index }: { item: Medication, index: number }) => {
        const log = logs.find(l => l.medicationId === item.id);
        const isDone = !!log;
        const status = log?.status;
        const stock = stockItems.find(s => s.medicationId === item.id);
        const isLowStock = stock && stock.quantity <= stock.threshold;

        const medBatches = batches.filter(b => b.medicationId === item.id);
        let expiredBatch = false;
        let expiringSoonBatch = false;
        const todayDate = new Date();
        todayDate.setHours(0,0,0,0);
        
        medBatches.forEach(b => {
             const exp = new Date(b.expiryDate);
             const daysDiff = (exp.getTime() - todayDate.getTime()) / (1000 * 3600 * 24);
             if (daysDiff < 0) expiredBatch = true;
             else if (daysDiff <= 30) expiringSoonBatch = true;
        });

        return (
            <Animated.View
                entering={FadeInDown.delay(index * 100)}
                layout={Layout.springify()}
            >
                <View style={[styles.medCard, isDone && styles.medCardDone, expiredBatch && !isDone ? { borderColor: '#FECACA', borderWidth: 1 } : null]}>
                    {expiredBatch && !isDone && (
                        <View style={styles.expiredWarningBanner}>
                            <Ionicons name="alert-circle" size={16} color="#B91C1C" />
                            <Text style={styles.expiredWarningText}>Hey, this is expired medicine. Check carefully before you consume!</Text>
                        </View>
                    )}
                    {!expiredBatch && expiringSoonBatch && !isDone && (
                        <View style={[styles.expiredWarningBanner, { backgroundColor: '#FFFBEB' }]}>
                            <Ionicons name="warning" size={16} color="#D97706" />
                            <Text style={[styles.expiredWarningText, { color: '#B45309' }]}>Some of these pills are expiring soon.</Text>
                        </View>
                    )}
                    <View style={styles.cardMain}>
                        <View style={[styles.iconContainer, { backgroundColor: item.color || '#4F46E5' }]}>
                            <Ionicons name={item.icon as any || 'medical'} size={24} color="#FFF" />
                        </View>
                        <View style={styles.medInfo}>
                            <View style={styles.nameRow}>
                                <Text style={styles.medName}>{item.name}</Text>
                                {isLowStock && (
                                    <View style={styles.lowStockBadge}>
                                        <Text style={styles.lowStockBadgeText}>Low Stock</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={styles.medDetails}>{item.dosage} • {item.time}</Text>
                        </View>
                        <View style={styles.actionButtons}>
                            <TouchableOpacity style={styles.actionButton} onPress={() => handleEdit(item)}>
                                <Ionicons name="pencil-outline" size={20} color="#6B7280" />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionButton} onPress={() => handleDelete(item)}>
                                <Ionicons name="trash-outline" size={20} color="#EF4444" />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.cardFooter}>
                        {isDone ? (
                            <View style={styles.statusBadgeContainer}>
                                <View style={styles.statusBadge}>
                                    <Ionicons
                                        name={status === 'taken' ? 'checkmark-circle' : 'close-circle'}
                                        size={20}
                                        color={status === 'taken' ? '#10B981' : '#EF4444'}
                                    />
                                    <Text style={[styles.statusBadgeText, { color: status === 'taken' ? '#10B981' : '#EF4444' }]}>
                                        {status === 'taken' ? 'Taken' : 'Skipped'}
                                    </Text>
                                </View>
                                <TouchableOpacity style={styles.undoButton} onPress={() => handleUndo(log.id)}>
                                    <Text style={styles.undoButtonText}>Undo</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.markButtons}>
                                <TouchableOpacity
                                    style={[styles.markButton, styles.skipButton]}
                                    onPress={() => handleMark(item, 'skipped')}
                                >
                                    <Text style={styles.skipButtonText}>Skip</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.markButton, styles.takeButton]}
                                    onPress={() => handleMark(item, 'taken')}
                                >
                                    <Text style={styles.takeButtonText}>Take</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                </View>
            </Animated.View>
        );
    };

    if (!isReady) return null;

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.greeting}>Schedule</Text>
                    <Text style={styles.date}>{format(new Date(), 'EEEE, MMMM do')}</Text>
                </View>
                <TouchableOpacity style={styles.addButton} onPress={() => router.push('/add-medicine')}>
                    <Ionicons name="add" size={28} color="#FFF" />
                </TouchableOpacity>
            </View>

            {permissionStatus !== 'granted' && (
                <TouchableOpacity style={styles.permissionWarning} onPress={handleRequestPermissions}>
                    <Ionicons name="notifications-outline" size={20} color="#B45309" />
                    <Text style={styles.permissionWarningText}>Enable notifications for reminders</Text>
                    <Ionicons name="chevron-forward" size={16} color="#B45309" />
                </TouchableOpacity>
            )}

            {lowStockMeds.length > 0 && (
                <TouchableOpacity style={styles.lowStockBanner} onPress={() => router.push('/stock')}>
                    <Ionicons name="warning" size={20} color="#991B1B" />
                    <Text style={styles.lowStockBannerText}>
                        {lowStockMeds.length} {lowStockMeds.length === 1 ? 'medicine' : 'medicines'} low on stock
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color="#991B1B" />
                </TouchableOpacity>
            )}

            <FlatList
                data={medications}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item, index }) => renderMedication({ item, index })}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="notifications-off-outline" size={64} color="#9CA3AF" />
                        <Text style={styles.emptyStateText}>No medications scheduled for today.</Text>
                        <TouchableOpacity style={styles.emptyStateButton} onPress={() => router.push('/add-medicine')}>
                            <Text style={styles.emptyStateButtonText}>Add your first medicine</Text>
                        </TouchableOpacity>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    header: {
        padding: 24,
        paddingTop: 60,
        backgroundColor: '#FFF',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    greeting: {
        fontSize: 24,
        fontFamily: 'OutfitBold',
        color: '#111827',
    },
    date: {
        fontSize: 16,
        color: '#6B7280',
        fontFamily: 'Outfit',
        marginTop: 4,
    },
    addButton: {
        backgroundColor: '#4F46E5',
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: '#4F46E5',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    list: {
        padding: 20,
    },
    medCard: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
    },
    medCardDone: {
        opacity: 0.8,
        backgroundColor: '#F9FAFB',
        borderColor: '#F3F4F6',
        borderWidth: 1,
        elevation: 0,
        shadowOpacity: 0,
    },
    cardMain: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    cardFooter: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    medInfo: {
        flex: 1,
        marginLeft: 16,
    },
    medName: {
        fontSize: 18,
        fontFamily: 'OutfitBold',
        color: '#111827',
    },
    medDetails: {
        fontSize: 14,
        color: '#6B7280',
        marginTop: 2,
    },
    actionButtons: {
        flexDirection: 'row',
    },
    actionButton: {
        padding: 8,
        marginLeft: 4,
    },
    statusBadgeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 4,
    },
    undoButton: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: '#F3F4F6',
    },
    undoButtonText: {
        fontSize: 12,
        color: '#6B7280',
        fontFamily: 'OutfitBold',
    },
    statusBadgeText: {
        fontSize: 14,
        fontFamily: 'OutfitBold',
        marginLeft: 6,
        textTransform: 'capitalize',
    },
    markButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    markButton: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    takeButton: {
        backgroundColor: '#4F46E5',
    },
    takeButtonText: {
        color: '#FFF',
        fontFamily: 'OutfitBold',
        fontSize: 14,
    },
    skipButton: {
        backgroundColor: '#F3F4F6',
    },
    skipButtonText: {
        color: '#6B7280',
        fontFamily: 'OutfitBold',
        fontSize: 14,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    lowStockBadge: {
        backgroundColor: '#FEF2F2',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    lowStockBadgeText: {
        fontSize: 10,
        color: '#DC2626',
        fontFamily: 'OutfitBold',
        textTransform: 'uppercase',
    },
    permissionWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFBEB',
        margin: 20,
        marginBottom: 0,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#FEF3C7',
    },
    permissionWarningText: {
        flex: 1,
        fontSize: 14,
        color: '#B45309',
        fontFamily: 'Outfit',
        marginLeft: 10,
    },
    lowStockBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        margin: 20,
        marginBottom: 0,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    lowStockBannerText: {
        flex: 1,
        fontSize: 14,
        color: '#991B1B',
        fontFamily: 'OutfitBold',
        marginLeft: 10,
    },
    emptyCircle: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: '#D1D5DB',
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
    },
    emptyStateText: {
        fontSize: 16,
        color: '#6B7280',
        marginTop: 16,
    },
    emptyStateButton: {
        marginTop: 24,
        backgroundColor: '#4F46E5',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
    },
    emptyStateButtonText: {
        color: '#FFF',
        fontFamily: 'OutfitBold',
        fontSize: 16,
    },
    expiredWarningBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        padding: 10,
        borderRadius: 8,
        marginBottom: 12,
        gap: 8,
    },
    expiredWarningText: {
        fontSize: 12,
        color: '#B91C1C',
        fontFamily: 'OutfitBold',
        flex: 1,
    },
});
