import { useDatabase } from '@/hooks/useDatabase';
import { addMedication, deleteMedication, getMedicationById, getStock, updateMedication, updateStock } from '@/services/db';
import { cancelMedicationNotifications, scheduleDailyRefillReminder, scheduleMedicationReminder, setupNotificationsAsync, showImmediateNotification } from '@/services/notifications';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AnimatedRN, { FadeInDown, Layout } from 'react-native-reanimated';

const ICONS = ['medical', 'fitness', 'flask', 'medkit', 'water', 'thermometer'];
const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function AddMedicineScreen() {
    const [name, setName] = useState('');
    const [dosage, setDosage] = useState('');
    const [time, setTime] = useState('08:00');
    const [period, setPeriod] = useState<'AM' | 'PM'>('AM');
    const [frequency, setFrequency] = useState('Daily');
    const [selectedIcon, setSelectedIcon] = useState(ICONS[0]);
    const [selectedColor, setSelectedColor] = useState(COLORS[0]);
    const [stockEnabled, setStockEnabled] = useState(false);
    const [stockQuantity, setStockQuantity] = useState('0');
    const [stockThreshold, setStockThreshold] = useState('0');
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    const router = useRouter();
    const { id } = useLocalSearchParams();
    const { refreshData, isReady } = useDatabase();
    const isEditing = !!id;

    const loadMedication = useCallback(async () => {
        try {
            const med = await getMedicationById(Number(id));
            if (med) {
                setName(med.name);
                setDosage(med.dosage);
                setTime(med.time);
                setFrequency(med.frequency);
                setSelectedIcon(med.icon);
                setSelectedColor(med.color);
                if (med.time) {
                    const match = med.time.match(/^(\d+:\d+)\s*(AM|PM)$/i);
                    if (match) {
                        setTime(match[1]);
                        setPeriod(match[2].toUpperCase() as any);
                    } else {
                        // Fallback for old 24h format
                        setTime(med.time);
                        const [h] = med.time.split(':').map(Number);
                        setPeriod(h >= 12 ? 'PM' : 'AM');
                    }
                }

                if (med.stockEnabled) {
                    const allStocks = await getStock();
                    const medStock = allStocks.find(s => s.medicationId === med.id);
                    if (medStock) {
                        setStockQuantity(medStock.quantity.toString());
                        setStockThreshold(medStock.threshold.toString());
                    }
                }
            }
        } catch (error) {
            console.error(error);
            Alert.alert('Error', 'Failed to load medication details');
        }
    }, [id]);

    useEffect(() => {
        if (isReady && isEditing) {
            loadMedication();
        }
    }, [id, isEditing, isReady, loadMedication]);

    const handleSave = async () => {
        if (!name || !dosage || !time) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Missing Info', 'Please fill in the medication name and dosage.');
            return;
        }

        try {
            const status = await setupNotificationsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Required', 'Please enable notifications in your phone settings to receive medication reminders.');
                return;
            }

            const medicationData = {
                name: name.trim(),
                dosage: dosage.trim(),
                frequency,
                time: `${time} ${period}`,
                icon: selectedIcon,
                color: selectedColor,
                stockEnabled: stockEnabled ? 1 : 0,
            };

            let medId: number;
            if (isEditing) {
                medId = parseInt(id as string);
                await updateMedication(medId, medicationData as any);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else {
                const result = await addMedication(medicationData as any);
                medId = result as number;
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }

            try {
                const fullTime = `${time} ${period}`;
                await cancelMedicationNotifications(medId);
                await scheduleMedicationReminder(medId, name, fullTime);
                
                if (stockEnabled) {
                    const qty = parseInt(stockQuantity || '0');
                    const threshold = parseInt(stockThreshold || '0');
                    await updateStock(medId, isNaN(qty) ? 0 : qty, isNaN(threshold) ? 0 : threshold);
                }
            } catch (notifyError) {
                console.error('Notification Setup Error:', notifyError);
            }

            await refreshData();
            
            // Show feedback
            const feedbackTitle = isEditing ? 'Changes Saved ✨' : 'Medication Added 💊';
            const feedbackBody = isEditing 
                ? `Updated ${name} successfully.` 
                : `Successfully added ${name} to your schedule.`;
            
            await showImmediateNotification(feedbackTitle, feedbackBody, { medId });
            
            router.back();
        } catch (error: any) {
            console.error('Save Error:', error);
            Alert.alert('Error', 'Failed to save medication.');
        }
    };

    const handleDelete = () => {
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        try {
            const medId = parseInt(id as string);
            await cancelMedicationNotifications(medId);
            await deleteMedication(medId);
            await refreshData();
            setShowDeleteModal(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
        } catch (error) {
            Alert.alert('Error', 'Failed to delete medication.');
        }
    };

    return (
        <View style={styles.container}>
            <StatusBar style="light" />
            
            {/* Custom Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
                    <Ionicons name="chevron-back" size={28} color="#6366F1" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{isEditing ? 'Edit Medicine' : 'Add New'}</Text>
                {isEditing ? (
                    <TouchableOpacity style={styles.headerButton} onPress={handleDelete}>
                        <Ionicons name="trash-outline" size={24} color="#EF4444" />
                    </TouchableOpacity>
                ) : (
                    <View style={{ width: 40 }} />
                )}
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    
                    {/* Basic Info Card */}
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Basic Information</Text>
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Medicine Name</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. Paracetamol"
                                placeholderTextColor="#9CA3AF"
                                value={name}
                                onChangeText={setName}
                            />
                        </View>
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Dosage</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. 500mg, 1 tablet"
                                placeholderTextColor="#9CA3AF"
                                value={dosage}
                                onChangeText={setDosage}
                            />
                        </View>
                    </View>

                    {/* Schedule Card */}
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Schedule</Text>
                            <Text style={styles.label}>Reminder Time</Text>
                            <View style={styles.timeInputRow}>
                                <TextInput
                                    style={[styles.input, { flex: 1 }]}
                                    placeholder="HH:mm (e.g. 09:30)"
                                    placeholderTextColor="#9CA3AF"
                                    value={time}
                                    onChangeText={(text) => {
                                        // Auto-add colon if missing
                                        if (text.length === 2 && !text.includes(':') && time.length < 2) {
                                            setTime(text + ':');
                                        } else {
                                            setTime(text);
                                        }
                                    }}
                                    keyboardType="numeric"
                                    maxLength={5}
                                />
                                <View style={styles.periodContainer}>
                                    <TouchableOpacity 
                                        style={[styles.periodButton, period === 'AM' && styles.periodButtonActive]}
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            setPeriod('AM');
                                        }}
                                    >
                                        <Text style={[styles.periodText, period === 'AM' && styles.periodTextActive]}>AM</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={[styles.periodButton, period === 'PM' && styles.periodButtonActive]}
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            setPeriod('PM');
                                        }}
                                    >
                                        <Text style={[styles.periodText, period === 'PM' && styles.periodTextActive]}>PM</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Frequency</Text>
                                <View style={styles.frequencyRow}>
                                    {['Daily', 'Weekly', 'As Needed'].map(f => (
                                        <TouchableOpacity 
                                            key={f}
                                            onPress={() => {
                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                                setFrequency(f);
                                            }}
                                            style={[styles.freqTab, frequency === f && styles.freqTabActive]}
                                        >
                                            <Text style={[styles.freqTabText, frequency === f && styles.freqTabActiveText]}>{f}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        </View>

                    {/* Style Card */}
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Personalize</Text>
                        <Text style={styles.label}>Icon Selection</Text>
                        <View style={styles.iconGrid}>
                            {ICONS.map((icon) => (
                                <TouchableOpacity
                                    key={icon}
                                    style={[
                                        styles.iconTile,
                                        selectedIcon === icon && { backgroundColor: selectedColor, borderColor: selectedColor }
                                    ]}
                                    onPress={() => {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        setSelectedIcon(icon);
                                    }}
                                >
                                    <Ionicons
                                        name={icon as any}
                                        size={24}
                                        color={selectedIcon === icon ? '#FFF' : '#6B7280'}
                                    />
                                </TouchableOpacity>
                            ))}
                        </View>
                        
                        <Text style={[styles.label, { marginTop: 16 }]}>Color Theme</Text>
                        <View style={styles.colorGrid}>
                            {COLORS.map((color) => (
                                <TouchableOpacity
                                    key={color}
                                    style={[
                                        styles.colorCircle,
                                        { backgroundColor: color },
                                        selectedColor === color && { borderColor: '#E5E7EB', borderWidth: 2 }
                                    ]}
                                    onPress={() => {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        setSelectedColor(color);
                                    }}
                                >
                                    {selectedColor === color && (
                                        <Ionicons name="checkmark" size={18} color="#FFF" />
                                    )}
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {/* Stock Tracking Card */}
                    <View style={styles.card}>
                        <View style={styles.switchRow}>
                            <View style={{ flex: 1, marginRight: 12 }}>
                                <Text style={styles.cardTitle}>Inventory Tracking</Text>
                                <Text style={styles.cardSubtitle}>Get alerts when stock is low</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    setStockEnabled(!stockEnabled);
                                }}
                                style={[styles.toggle, stockEnabled && styles.toggleActive]}
                            >
                                <View style={[styles.toggleDot, stockEnabled && styles.toggleDotActive]} />
                            </TouchableOpacity>
                        </View>

                        {stockEnabled && (
                            <AnimatedRN.View 
                                entering={FadeInDown.duration(400)} 
                                layout={Layout.springify()}
                                style={styles.stockForm}
                            >
                                <View style={styles.inputRow}>
                                    <View style={[styles.inputGroup, { flex: 1, marginRight: 12 }]}>
                                        <Text style={styles.label} numberOfLines={1}>Initial Stock</Text>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="0"
                                            keyboardType="numeric"
                                            value={stockQuantity}
                                            onChangeText={setStockQuantity}
                                            selectTextOnFocus
                                        />
                                    </View>
                                    <View style={[styles.inputGroup, { flex: 1 }]}>
                                        <Text style={styles.label} numberOfLines={1}>Alert Level</Text>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="0"
                                            keyboardType="numeric"
                                            value={stockThreshold}
                                            onChangeText={setStockThreshold}
                                            selectTextOnFocus
                                        />
                                    </View>
                                </View>
                                <Text style={styles.stockHelpText}>
                                    We'll notify you when your stock levels fall below the alert level.
                                </Text>
                            </AnimatedRN.View>
                        )}
                    </View>

                    {/* Save Button */}
                    <TouchableOpacity style={styles.primaryButton} onPress={handleSave}>
                        <Text style={styles.primaryButtonText}>
                            {isEditing ? 'Update Medication' : 'Save Medication'}
                        </Text>
                    </TouchableOpacity>

                    {/* Styled Delete Button (Only when editing) */}
                    {isEditing && (
                        <TouchableOpacity 
                            style={styles.deleteFormButton} 
                            onPress={() => {
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                handleDelete();
                            }}
                        >
                            <Ionicons name="trash-outline" size={20} color="#EF4444" style={{ marginRight: 8 }} />
                            <Text style={styles.deleteFormButtonText}>Delete Medication</Text>
                        </TouchableOpacity>
                    )}

                </ScrollView>
            </KeyboardAvoidingView>

            <Modal
                transparent
                visible={showDeleteModal}
                animationType="fade"
                onRequestClose={() => setShowDeleteModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <AnimatedRN.View 
                        entering={FadeInDown}
                        style={styles.modalContent}
                    >
                        <View style={styles.modalIconContainer}>
                            <Ionicons name="trash" size={32} color="#EF4444" />
                        </View>
                        <Text style={styles.modalTitle}>Delete Medication</Text>
                        <Text style={styles.modalMessage}>
                            Are you sure you want to remove <Text style={{ fontFamily: 'OutfitBold' }}>{name}</Text> and all its history? 
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
                    </AnimatedRN.View>
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
    stockHelpText: {
        fontSize: 12,
        color: '#6B7280',
        fontFamily: 'Outfit',
        marginTop: 4,
        marginLeft: 4,
        lineHeight: 18,
    },
    header: {
        backgroundColor: '#4F46E5', // Professional Indigo
        paddingTop: 60,
        paddingBottom: 20,
        paddingHorizontal: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomLeftRadius: 32,
        borderBottomRightRadius: 32,
        elevation: 12,
        shadowColor: '#6366F1',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 15,
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#FFF',
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
    },
    headerTitle: {
        fontSize: 20,
        fontFamily: 'OutfitBold',
        color: '#FFF',
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 40,
    },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        padding: 20,
        marginBottom: 20,
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
    },
    cardTitle: {
        fontSize: 18,
        fontFamily: 'OutfitBold',
        color: '#111827',
        marginBottom: 16,
    },
    cardSubtitle: {
        fontSize: 13,
        color: '#6B7280',
        fontFamily: 'Outfit',
        marginTop: -12,
        marginBottom: 16,
    },
    inputGroup: {
        marginBottom: 16,
    },
    label: {
        fontSize: 13,
        fontFamily: 'OutfitBold',
        color: '#4B5563',
        marginBottom: 8,
        marginLeft: 4,
    },
    input: {
        backgroundColor: '#F3F4F6',
        borderRadius: 16,
        padding: 16,
        fontSize: 16,
        fontFamily: 'Outfit',
        color: '#111827',
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    timeInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
    },
    periodContainer: {
        flexDirection: 'row',
        backgroundColor: '#F3F4F6',
        borderRadius: 16,
        padding: 4,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    periodButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 12,
    },
    periodButtonActive: {
        backgroundColor: '#6366F1',
    },
    periodText: {
        fontSize: 14,
        fontFamily: 'OutfitBold',
        color: '#6B7280',
    },
    periodTextActive: {
        color: '#FFF',
    },
    frequencyRow: {
        flexDirection: 'row',
        gap: 8,
    },
    freqTab: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: '#F3F4F6',
        alignItems: 'center',
    },
    freqTabActive: {
        backgroundColor: '#6366F1',
    },
    freqTabText: {
        fontSize: 14,
        fontFamily: 'Outfit',
        color: '#6B7280',
    },
    freqTabActiveText: {
        color: '#FFF',
        fontFamily: 'OutfitBold',
    },
    iconGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    iconTile: {
        width: 52,
        height: 52,
        borderRadius: 16,
        backgroundColor: '#F3F4F6',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: 'transparent',
    },
    colorGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    colorCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
    },
    toggle: {
        width: 54,
        height: 30,
        borderRadius: 15,
        backgroundColor: '#E5E7EB',
        padding: 4,
    },
    toggleActive: {
        backgroundColor: '#10B981',
    },
    toggleDot: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#FFF',
    },
    toggleDotActive: {
        marginLeft: 24,
    },
    inputRow: {
        flexDirection: 'row',
    },
    stockForm: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    primaryButton: {
        backgroundColor: '#6366F1',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
        marginTop: 12,
        elevation: 8,
        shadowColor: '#6366F1',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
    },
    primaryButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontFamily: 'OutfitBold',
    },
    deleteFormButton: {
        flexDirection: 'row',
        backgroundColor: '#FEF2F2',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 16,
        borderWidth: 1,
        borderColor: '#FEE2E2',
    },
    deleteFormButtonText: {
        color: '#EF4444',
        fontSize: 16,
        fontFamily: 'OutfitBold',
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
});
