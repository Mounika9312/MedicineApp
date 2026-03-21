import { useDatabase } from '@/hooks/useDatabase';
import { getStock, refillStock, Stock, getAllBatches, StockBatch } from '@/services/db';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function StockScreen() {
    const { isReady } = useDatabase();
    const [stockItems, setStockItems] = useState<(Stock & { name: string })[]>([]);
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [refillAmount, setRefillAmount] = useState('');
    const [refillExpiry, setRefillExpiry] = useState('');
    const [selectedItem, setSelectedItem] = useState<(Stock & { name: string }) | null>(null);
    const [showLowStockOnly, setShowLowStockOnly] = useState(false);
    const [batches, setBatches] = useState<StockBatch[]>([]);

    useEffect(() => {
        if (isReady) {
            loadStock();
        }
    }, [isReady]);

    const loadStock = async () => {
        const [data, batchData] = await Promise.all([getStock(), getAllBatches()]);
        setStockItems(data);
        setBatches(batchData);
    };

    const filteredItems = showLowStockOnly
        ? stockItems.filter(item => item.quantity <= item.threshold)
        : stockItems;

    const handleShareShoppingList = async () => {
        const lowStockItems = stockItems.filter(item => item.quantity <= item.threshold);
        if (lowStockItems.length === 0) {
            Alert.alert('All Set!', 'You have no items below their threshold.');
            return;
        }

        const list = lowStockItems.map(s => `- ${s.name} (Current: ${s.quantity}, need more than ${s.threshold})`).join('\n');
        try {
            await Share.share({
                title: 'Medicine Shopping List',
                message: `Medicine Shopping List:\n\n${list}\n\nPlease refill these soon.`,
            });
        } catch (error) {
            Alert.alert('Error', 'Failed to share shopping list');
        }
    };

    const handleShare = async () => {
        const stockReport = stockItems.map(s => `${s.name}: ${s.quantity} units (Threshold: ${s.threshold})`).join('\n');
        try {
            await Share.share({
                message: `Medicine Stock Report:\n\n${stockReport}`,
            });
        } catch (error) {
            Alert.alert('Error', 'Failed to share report');
        }
    };

    const handleRefill = (item: Stock & { name: string }) => {
        setSelectedItem(item);
        setRefillAmount('');
        setRefillExpiry('');
        setIsModalVisible(true);
    };

    const confirmRefill = async () => {
        const qty = parseInt(refillAmount || '0');
        if (isNaN(qty) || qty <= 0) {
            Alert.alert('Invalid Amount', 'Please enter a valid number.');
            return;
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(refillExpiry)) {
            Alert.alert('Invalid Date', 'Please enter a date in YYYY-MM-DD format.');
            return;
        }

        if (selectedItem) {
            await refillStock(selectedItem.medicationId, qty, refillExpiry);
            setIsModalVisible(false);
            setSelectedItem(null);
            loadStock();
        }
    };

    const renderStockItem = ({ item }: { item: (Stock & { name: string }) }) => {
        const isLow = item.quantity <= item.threshold;
        const itemBatches = batches.filter(b => b.medicationId === item.medicationId);
        const sortedBatches = [...itemBatches].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
        
        const getBatchStatus = (dateStr: string) => {
            const today = new Date();
            today.setHours(0,0,0,0);
            const exp = new Date(dateStr);
            const daysDiff = (exp.getTime() - today.getTime()) / (1000 * 3600 * 24);
            if (daysDiff < 0) return { color: '#EF4444', label: 'Expired' };
            if (daysDiff <= 30) return { color: '#F59E0B', label: 'Expiring Soon' };
            return { color: '#10B981', label: 'Good' };
        };

        return (
            <View style={styles.stockCard}>
                <View style={styles.cardHeader}>
                    <View style={styles.stockInfo}>
                        <Text style={styles.medName}>{item.name}</Text>
                        <Text style={[styles.qtyText, isLow && styles.lowQty]}>
                            {item.quantity} units total
                        </Text>
                    </View>
                    {isLow && (
                        <View style={styles.warningBadge}>
                            <Ionicons name="warning" size={16} color="#B45309" />
                            <Text style={styles.warningText}>Low Stock</Text>
                        </View>
                    )}
                </View>

                {sortedBatches.length > 0 && item.quantity > 0 && (
                    <View style={styles.batchesContainer}>
                        <View style={styles.progressBar}>
                            {sortedBatches.map(batch => {
                                const widthPct = Math.max(2, (batch.quantity / item.quantity) * 100);
                                const status = getBatchStatus(batch.expiryDate);
                                return (
                                    <View 
                                        key={batch.id} 
                                        style={[styles.progressSegment, { width: `${widthPct}%`, backgroundColor: status.color }]} 
                                    />
                                );
                            })}
                        </View>
                        <View style={styles.batchesList}>
                            {sortedBatches.map(batch => {
                                const status = getBatchStatus(batch.expiryDate);
                                return (
                                    <View key={batch.id} style={styles.batchRow}>
                                        <View style={[styles.batchDot, { backgroundColor: status.color }]} />
                                        <Text style={styles.batchQuantityText}>{batch.quantity} pills</Text>
                                        <Text style={styles.batchExpiryText}>exp. {batch.expiryDate}</Text>
                                        {status.label !== 'Good' && (
                                            <View style={[styles.batchTag, { backgroundColor: status.color + '20' }]}>
                                                <Text style={[styles.batchTagText, { color: status.color }]}>{status.label}</Text>
                                            </View>
                                        )}
                                    </View>
                                );
                            })}
                        </View>
                    </View>
                )}

                <View style={styles.cardFooter}>
                    <View style={styles.thresholdInfo}>
                        <Text style={styles.thresholdLabel}>Threshold:</Text>
                        <Text style={styles.thresholdValue}>{item.threshold} units</Text>
                    </View>
                    <TouchableOpacity style={styles.refillButton} onPress={() => handleRefill(item)}>
                        <Ionicons name="add-circle-outline" size={20} color="#FFF" />
                        <Text style={styles.refillButtonText}>Refill</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>Inventory</Text>
                    <Text style={styles.subtitle}>Track your medication stock</Text>
                </View>
                <View style={styles.headerButtons}>
                    <TouchableOpacity style={styles.headerButton} onPress={handleShareShoppingList}>
                        <Ionicons name="cart-outline" size={20} color="#4F46E5" />
                        <Text style={styles.headerButtonText}>List</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.headerButton} onPress={handleShare}>
                        <Ionicons name="share-outline" size={20} color="#4F46E5" />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.filterContainer}>
                <TouchableOpacity
                    style={[styles.filterTab, !showLowStockOnly && styles.filterTabActive]}
                    onPress={() => setShowLowStockOnly(false)}
                >
                    <Text style={[styles.filterTabText, !showLowStockOnly && styles.filterTabActiveText]}>All Items</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.filterTab, showLowStockOnly && styles.filterTabActive]}
                    onPress={() => setShowLowStockOnly(true)}
                >
                    <Text style={[styles.filterTabText, showLowStockOnly && styles.filterTabActiveText]}>Low Stock</Text>
                    {stockItems.filter(i => i.quantity <= i.threshold).length > 0 && (
                        <View style={styles.countBadge}>
                            <Text style={styles.countBadgeText}>
                                {stockItems.filter(i => i.quantity <= i.threshold).length}
                            </Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>

            <FlatList
                data={filteredItems}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderStockItem}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="cube-outline" size={64} color="#9CA3AF" />
                        <Text style={styles.emptyStateText}>No stock tracking enabled for your medicines.</Text>
                    </View>
                }
            />

            <Modal
                visible={isModalVisible}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setIsModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Refill Medicine</Text>
                        <Text style={styles.modalSubtitle}>
                            How many units of {selectedItem?.name} are you adding?
                        </Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Enter amount"
                            value={refillAmount}
                            onChangeText={setRefillAmount}
                            keyboardType="number-pad"
                            autoFocus={true}
                        />
                        <Text style={[styles.modalSubtitle, { marginBottom: 8, marginTop: -8 }]}>
                            Expiry Date (YYYY-MM-DD):
                        </Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="e.g. 2026-12-31"
                            value={refillExpiry}
                            onChangeText={setRefillExpiry}
                        />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.cancelButton]}
                                onPress={() => setIsModalVisible(false)}
                            >
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.confirmButton]}
                                onPress={confirmRefill}
                            >
                                <Text style={styles.confirmButtonText}>Refill</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
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
        padding: 24,
        paddingTop: 60,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    title: {
        fontSize: 28,
        fontFamily: 'OutfitBold',
        color: '#111827',
    },
    subtitle: {
        fontSize: 14,
        color: '#6B7280',
        fontFamily: 'Outfit',
        marginTop: 2,
    },
    headerButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    headerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: '#EEF2FF',
        gap: 6,
    },
    headerButtonText: {
        color: '#4F46E5',
        fontFamily: 'OutfitBold',
        fontSize: 14,
    },
    filterContainer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingVertical: 12,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        gap: 12,
    },
    filterTab: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#F3F4F6',
    },
    filterTabActive: {
        backgroundColor: '#4F46E5',
    },
    filterTabText: {
        fontSize: 14,
        fontFamily: 'Outfit',
        color: '#6B7280',
    },
    filterTabActiveText: {
        color: '#FFF',
        fontFamily: 'OutfitBold',
    },
    countBadge: {
        backgroundColor: '#EF4444',
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 6,
        paddingHorizontal: 4,
    },
    countBadgeText: {
        color: '#FFF',
        fontSize: 10,
        fontFamily: 'OutfitBold',
    },
    list: {
        padding: 20,
    },
    stockCard: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        paddingBottom: 12,
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 12,
    },
    stockInfo: {
        flex: 1,
    },
    medName: {
        fontSize: 18,
        fontFamily: 'OutfitBold',
        color: '#111827',
    },
    qtyText: {
        fontSize: 15,
        color: '#6B7280',
        fontFamily: 'Outfit',
        marginTop: 4,
    },
    lowQty: {
        color: '#EF4444',
        fontFamily: 'OutfitBold',
    },
    thresholdInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    thresholdLabel: {
        fontSize: 12,
        color: '#9CA3AF',
        fontFamily: 'Outfit',
    },
    thresholdValue: {
        fontSize: 12,
        color: '#6B7280',
        fontFamily: 'OutfitBold',
        marginLeft: 4,
    },
    refillButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#4F46E5',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
    },
    refillButtonText: {
        color: '#FFF',
        fontFamily: 'OutfitBold',
        fontSize: 14,
        marginLeft: 4,
    },
    warningBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    warningText: {
        marginLeft: 4,
        color: '#B45309',
        fontSize: 12,
        fontFamily: 'OutfitBold',
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
        textAlign: 'center',
        paddingHorizontal: 40,
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
        borderRadius: 20,
        padding: 24,
        width: '100%',
        maxWidth: 400,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
    },
    modalTitle: {
        fontSize: 20,
        fontFamily: 'OutfitBold',
        color: '#111827',
        marginBottom: 8,
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#6B7280',
        fontFamily: 'Outfit',
        marginBottom: 20,
    },
    modalInput: {
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        fontFamily: 'Outfit',
        color: '#111827',
        marginBottom: 24,
    },
    modalButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    modalButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        backgroundColor: '#F3F4F6',
    },
    cancelButtonText: {
        color: '#6B7280',
        fontFamily: 'OutfitBold',
        fontSize: 16,
    },
    confirmButton: {
        backgroundColor: '#4F46E5',
    },
    confirmButtonText: {
        color: '#FFF',
        fontFamily: 'OutfitBold',
        fontSize: 16,
    },
    batchesContainer: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    progressBar: {
        height: 12,
        backgroundColor: '#E5E7EB',
        borderRadius: 6,
        flexDirection: 'row',
        overflow: 'hidden',
        marginBottom: 12,
    },
    progressSegment: {
        height: '100%',
        borderRightWidth: 1,
        borderRightColor: '#FFF',
    },
    batchesList: {
        gap: 8,
    },
    batchRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    batchDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 8,
    },
    batchQuantityText: {
        fontSize: 14,
        fontFamily: 'OutfitBold',
        color: '#374151',
        width: 60,
    },
    batchExpiryText: {
        fontSize: 14,
        fontFamily: 'Outfit',
        color: '#6B7280',
        flex: 1,
    },
    batchTag: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    batchTagText: {
        fontSize: 10,
        fontFamily: 'OutfitBold',
        textTransform: 'uppercase',
    },
});
