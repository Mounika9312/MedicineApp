import { useDatabase } from '@/hooks/useDatabase';
import { Medication, deleteLog, deleteMedication, getLogs, getStock, logMedication, getAllBatches, StockBatch } from '@/services/db';
import { getNotificationStatusAsync, setupNotificationsAsync, cancelMedicationNotifications, scheduleTestNotification, getScheduledNotificationsInfo, rescheduleAllNotifications, showImmediateNotification } from '@/services/notifications';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';

export default function ScheduleScreen() {
    const { medications, isReady, refreshData } = useDatabase();
    const [logs, setLogs] = useState<any[]>([]);
    const [stockItems, setStockItems] = useState<any[]>([]);
    const [batches, setBatches] = useState<StockBatch[]>([]);
    const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deletingMed, setDeletingMed] = useState<Medication | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [lowStockCount, setLowStockCount] = useState(0);
    const [scheduledReminders, setScheduledReminders] = useState<any[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const router = useRouter();
    const today = format(new Date(), 'yyyy-MM-dd');

    const lowStockMeds = medications.filter(med => {
        const stock = stockItems.find(s => s.medicationId === med.id);
        return stock && stock.quantity <= stock.threshold;
    });

    useEffect(() => {
        if (isReady) {
            checkPermissions();
            checkLowStock();
        }
    }, [isReady, medications]);

    const checkLowStock = async () => {
        const currentStockItems = await getStock();
        const low = currentStockItems.filter(i => i.quantity <= i.threshold).length;
        setLowStockCount(low);
    };

    const checkPermissions = async () => {
        const status = await getNotificationStatusAsync();
        setPermissionStatus(status);
    };

    const handleRequestPermissions = async () => {
        await setupNotificationsAsync();
        checkPermissions();
    };

    const loadData = useCallback(async () => {
        if (!isReady) return;
        const [todayLogs, currentStock, allBatches, scheduled] = await Promise.all([
            getLogs(today),
            getStock(),
            getAllBatches(),
            getScheduledNotificationsInfo()
        ]);
        setLogs(todayLogs);
        setStockItems(currentStock);
        setBatches(allBatches);
        setScheduledReminders(scheduled);
        setLowStockCount(currentStock.filter(i => i.quantity <= i.threshold).length);
    }, [today, isReady]);

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            const status = await setupNotificationsAsync();
            if (status !== 'granted') {
                return;
            }
            const currentStock = await getStock();
            await rescheduleAllNotifications(medications, currentStock);
            await loadData();
            await showImmediateNotification('Sync Successful ✨', 'All your medication reminders have been refreshed and verified.');
        } catch (error) {
            console.error('Sync error:', error);
        } finally {
            setIsSyncing(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            if (isReady) {
                loadData();
            }
        }, [loadData, isReady])
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
            
            // Show feedback
            const statusLabel = status === 'taken' ? 'Take Dosed ✅' : 'Dose Skipped ❌';
            const statusMsg = status === 'taken' 
                ? `Well done! You have recorded your ${med.name} dose.` 
                : `You flagged your ${med.name} dose as skipped.`;
            
            await showImmediateNotification(statusLabel, statusMsg, { medId: med.id });
            
            loadData();
            refreshData(); // To update stock if taken
        }
    };

    const handleUndo = async (logId: number) => {
        await deleteLog(logId);
        loadData();
        refreshData();
    };

    const handleDelete = (med: Medication) => {
        setDeletingMed(med);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        if (deletingMed) {
            await cancelMedicationNotifications(deletingMed.id);
            await deleteMedication(deletingMed.id);
            setShowDeleteModal(false);
            setDeletingMed(null);
            refreshData();
            loadData();
        }
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
             const [y, m, d] = b.expiryDate.split('-').map(Number);
             const exp = new Date(y, m - 1, d);
             const daysDiff = Math.floor((exp.getTime() - todayDate.getTime()) / (1000 * 3600 * 24));
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
                        <TouchableOpacity 
                            style={styles.medInfoTouch} 
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                handleEdit(item);
                            }}
                        >
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
                        </TouchableOpacity>
                        <View style={styles.actionButtons}>
                            <TouchableOpacity 
                                style={[styles.actionButton, styles.editButton]} 
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    handleEdit(item);
                                }}
                            >
                                <Ionicons name="pencil" size={18} color="#6366F1" />
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={[styles.actionButton, styles.deleteButton]} 
                                onPress={() => {
                                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                    handleDelete(item);
                                }}
                            >
                                <Ionicons name="trash-outline" size={18} color="#EF4444" />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {item.stockEnabled && stock && (
                        <View style={styles.inventoryBar}>
                            <View style={styles.inventoryInfo}>
                                <Ionicons name="cube-outline" size={14} color="#6B7280" />
                                <Text style={styles.inventoryText}>
                                    Stock: <Text style={[styles.inventoryValue, isLowStock && { color: '#EF4444' }]}>{stock.quantity}</Text> 
                                    <Text style={styles.inventoryLabel}> / Threshold: </Text>
                                    <Text style={styles.inventoryValue}>{stock.threshold}</Text>
                                </Text>
                            </View>
                            {isLowStock && (
                                <View style={styles.lowStockIndicator}>
                                    <Ionicons name="alert-circle" size={14} color="#EF4444" />
                                    <Text style={styles.lowStockIndicatorText}>Refill Soon</Text>
                                </View>
                            )}
                        </View>
                    )}

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
                                <TouchableOpacity style={styles.undoButton} onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    handleUndo(log.id);
                                }}>
                                    <Text style={styles.undoButtonText}>Undo</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.markButtons}>
                                <TouchableOpacity
                                    style={[styles.markButton, styles.skipButton]}
                                    onPress={() => {
                                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                        handleMark(item, 'skipped');
                                    }}
                                >
                                    <Text style={styles.skipButtonText}>Skip</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.markButton, styles.takeButton]}
                                    onPress={() => {
                                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                        handleMark(item, 'taken');
                                    }}
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

    const filteredMedications = medications.filter(med => 
        med.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        med.dosage.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <View style={styles.container}>
            <StatusBar style="light" />
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <View>
                        <Text style={styles.headerTitle}>Schedule</Text>
                        <Text style={styles.date}>{format(new Date(), 'EEEE, MMMM do')}</Text>
                    </View>
                    <View style={styles.headerActions}>
                        <TouchableOpacity style={styles.addButton} onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            router.push('/add-medicine');
                        }}>
                            <Ionicons name="add" size={32} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Search Bar - Extra Feature */}
                <View style={styles.searchContainer}>
                    <Ionicons name="search" size={20} color="rgba(255,255,255,0.7)" style={styles.searchIcon} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search medicines or dosage..."
                        placeholderTextColor="rgba(255,255,255,0.5)"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        autoCorrect={false}
                        autoCapitalize="none"
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={20} color="#FFF" />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {permissionStatus !== 'granted' && (
                <TouchableOpacity style={styles.permissionWarning} onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    handleRequestPermissions();
                }}>
                    <Ionicons name="notifications-outline" size={20} color="#B45309" />
                    <Text style={styles.permissionWarningText}>Enable notifications for reminders</Text>
                    <Ionicons name="chevron-forward" size={16} color="#B45309" />
                </TouchableOpacity>
            )}

            <FlatList
                data={filteredMedications}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item, index }) => renderMedication({ item, index })}
                contentContainerStyle={styles.list}
                ListHeaderComponent={
                    lowStockCount > 0 ? (
                        <Animated.View entering={FadeInDown} style={styles.alertBanner}>
                            <TouchableOpacity 
                                style={styles.alertContent}
                                onPress={() => router.push('/(tabs)/stock')}
                            >
                                <View style={styles.alertLeft}>
                                    <View style={styles.alertIconBg}>
                                        <Ionicons name="warning" size={16} color="#FFF" />
                                    </View>
                                    <Text style={styles.alertText}>
                                        {lowStockCount} {lowStockCount === 1 ? 'medicine is' : 'medicines are'} low on stock
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color="#EF4444" />
                            </TouchableOpacity>
                        </Animated.View>
                    ) : null
                }
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

            <Modal
                transparent
                visible={showDeleteModal}
                animationType="fade"
                onRequestClose={() => setShowDeleteModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <Animated.View 
                        entering={FadeInDown}
                        style={styles.modalContent}
                    >
                        <View style={styles.modalIconContainer}>
                            <Ionicons name="trash" size={32} color="#EF4444" />
                        </View>
                        <Text style={styles.modalTitle}>Delete Medication</Text>
                        <Text style={styles.modalMessage}>
                            Are you sure you want to delete <Text style={{ fontFamily: 'OutfitBold' }}>{deletingMed?.name}</Text>? 
                            This action cannot be undone.
                        </Text>
                        <View style={styles.modalButtons}>
                            <TouchableOpacity 
                                style={[styles.modalButton, styles.cancelButton]}
                                onPress={() => setShowDeleteModal(false)}
                            >
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={[styles.modalButton, styles.confirmButton]}
                                onPress={confirmDelete}
                            >
                                <Text style={styles.confirmButtonText}>Delete</Text>
                            </TouchableOpacity>
                        </View>
                    </Animated.View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    header: {
        backgroundColor: '#4F46E5', // Professional Indigo
        paddingTop: 64,
        paddingBottom: 24,
        paddingHorizontal: 20,
        borderBottomLeftRadius: 40,
        borderBottomRightRadius: 40,
        elevation: 12,
        shadowColor: '#4F46E5',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.4,
        shadowRadius: 15,
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    headerTitle: {
        fontSize: 32,
        fontFamily: 'OutfitBold',
        color: '#FFF',
    },
    date: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.8)',
        fontFamily: 'Outfit',
        marginTop: 4,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderRadius: 16,
        paddingHorizontal: 15,
        height: 52,
    },
    searchIcon: {
        marginRight: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        fontFamily: 'Outfit',
        color: '#FFF',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    testButton: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.9)',
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    addButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
    },
    alertBanner: {
        marginBottom: 20,
    },
    alertContent: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        elevation: 6,
        shadowColor: '#EF4444',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        borderWidth: 1,
        borderColor: '#FEE2E2',
    },
    alertLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    alertIconBg: {
        width: 28,
        height: 28,
        borderRadius: 8,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    alertText: {
        fontSize: 14,
        fontFamily: 'OutfitBold',
        color: '#1E293B',
    },
    list: {
        padding: 20,
    },
    medCard: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        padding: 16,
        marginBottom: 16,
        elevation: 6,
        shadowColor: '#6366F1',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 15,
        borderLeftWidth: 6,
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
        width: '100%',
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
    medInfoTouch: {
        flexDirection: 'row',
        flex: 1,
        alignItems: 'center',
    },
    medInfo: {
        marginLeft: 16,
        flex: 1,
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
        gap: 8,
        alignItems: 'center',
    },
    actionButton: {
        width: 38,
        height: 38,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    editButton: {
        backgroundColor: '#E0E7FF',
        borderWidth: 1,
        borderColor: '#C7D2FE',
    },
    deleteButton: {
        backgroundColor: '#FEE2E2',
        borderWidth: 1,
        borderColor: '#FECACA',
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
        backgroundColor: '#6366F1',
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
        backgroundColor: '#6366F1',
        paddingHorizontal: 32,
        paddingVertical: 16,
        borderRadius: 16,
        elevation: 8,
        shadowColor: '#6366F1',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
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
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    modalContent: {
        backgroundColor: '#FFF',
        borderRadius: 32,
        padding: 32,
        width: '100%',
        alignItems: 'center',
        elevation: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
    },
    modalIconContainer: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: '#FEF2F2',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 22,
        fontFamily: 'OutfitBold',
        color: '#111827',
        marginBottom: 12,
    },
    modalMessage: {
        fontSize: 16,
        color: '#6B7280',
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 32,
        fontFamily: 'Outfit',
    },
    modalButtons: {
        flexDirection: 'row',
        gap: 16,
        width: '100%',
    },
    modalButton: {
        flex: 1,
        paddingVertical: 16,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        backgroundColor: '#F3F4F6',
    },
    cancelButtonText: {
        fontSize: 16,
        fontFamily: 'OutfitBold',
        color: '#4B5563',
    },
    confirmButton: {
        backgroundColor: '#EF4444',
    },
    confirmButtonText: {
        fontSize: 16,
        fontFamily: 'OutfitBold',
        color: '#FFF',
    },
    reminderStatus: {
        marginTop: 6,
    },
    reminderActive: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#ECFDF5',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
        alignSelf: 'flex-start',
    },
    reminderActiveText: {
        fontSize: 11,
        color: '#10B981',
        fontFamily: 'OutfitBold',
    },
    reminderMissing: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#FEF2F2',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
        alignSelf: 'flex-start',
    },
    reminderMissingText: {
        fontSize: 11,
        color: '#EF4444',
        fontFamily: 'OutfitBold',
    },
    inventoryBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#F9FAFB',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    inventoryInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    inventoryText: {
        fontSize: 12,
        color: '#6B7280',
        fontFamily: 'Outfit',
    },
    inventoryValue: {
        fontFamily: 'OutfitBold',
        color: '#111827',
    },
    inventoryLabel: {
        color: '#9CA3AF',
    },
    lowStockIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    lowStockIndicatorText: {
        fontSize: 11,
        color: '#EF4444',
        fontFamily: 'OutfitBold',
    },
});
