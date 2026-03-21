import { useDatabase } from '@/hooks/useDatabase';
import { addMedication, getMedicationById, getStock, updateMedication, updateStock } from '@/services/db';
import { scheduleDailyRefillReminder, scheduleMedicationReminder } from '@/services/notifications';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const ICONS = ['medical', 'fitness', 'flask', 'medkit', 'water', 'thermometer'];
const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function AddMedicineScreen() {
    const [name, setName] = useState('');
    const [dosage, setDosage] = useState('');
    const [time, setTime] = useState('08:00');
    const [frequency, setFrequency] = useState('Daily');
    const [selectedIcon, setSelectedIcon] = useState(ICONS[0]);
    const [selectedColor, setSelectedColor] = useState(COLORS[0]);
    const [stockEnabled, setStockEnabled] = useState(false);
    const [stockQuantity, setStockQuantity] = useState('');
    const [stockThreshold, setStockThreshold] = useState('');
    const [refillReminderTime, setRefillReminderTime] = useState('09:00');

    const router = useRouter();
    const { id } = useLocalSearchParams();
    const { refreshData } = useDatabase();
    const isEditing = !!id;

    useEffect(() => {
        if (isEditing) {
            loadMedication();
        }
    }, [id]);

    const loadMedication = async () => {
        try {
            const med = await getMedicationById(Number(id));
            if (med) {
                setName(med.name);
                setDosage(med.dosage);
                setTime(med.time);
                setFrequency(med.frequency);
                setSelectedIcon(med.icon);
                setSelectedColor(med.color);
                setStockEnabled(med.stockEnabled);

                if (med.stockEnabled) {
                    const allStocks = await getStock();
                    const medStock = allStocks.find(s => s.medicationId === med.id);
                    if (medStock) {
                        setStockQuantity(medStock.quantity.toString());
                        setStockThreshold(medStock.threshold.toString());
                        if (medStock.refillReminderTime) {
                            setRefillReminderTime(medStock.refillReminderTime);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(error);
            Alert.alert('Error', 'Failed to load medication details');
        }
    };

    const handleSave = async () => {
        if (!name || !dosage || !time) {
            Alert.alert('Error', 'Please fill in all required fields');
            return;
        }

        try {
            const medicationData = {
                name,
                dosage,
                frequency,
                time,
                icon: selectedIcon,
                color: selectedColor,
                stockEnabled,
            };

            let medId: number;
            if (isEditing) {
                medId = Number(id);
                await updateMedication(medId, medicationData);
            } else {
                medId = await addMedication(medicationData);
            }

            if (stockEnabled) {
                await updateStock(
                    medId,
                    parseInt(stockQuantity || '0'),
                    parseInt(stockThreshold || '0'),
                    refillReminderTime
                );

                // If stock is already low, schedule the daily reminder
                if (parseInt(stockQuantity || '0') <= parseInt(stockThreshold || '0')) {
                    await scheduleDailyRefillReminder(name, refillReminderTime);
                }
            }

            await scheduleMedicationReminder(medId, name, time);

            await refreshData();
            router.back();
        } catch (error) {
            console.error(error);
            Alert.alert('Error', `Failed to ${isEditing ? 'update' : 'save'} medication`);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.section}>
                    <Text style={styles.label}>Medication Name</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Vitamin C"
                        value={name}
                        onChangeText={setName}
                    />
                </View>

                <View style={styles.section}>
                    <Text style={styles.label}>Dosage</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. 500mg"
                        value={dosage}
                        onChangeText={setDosage}
                    />
                </View>

                <View style={styles.section}>
                    <Text style={styles.label}>Time</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="HH:mm (e.g. 08:30)"
                        value={time}
                        onChangeText={setTime}
                    />
                </View>

                <View style={styles.section}>
                    <Text style={styles.label}>Select Icon & Color</Text>
                    <View style={styles.grid}>
                        {ICONS.map((icon) => (
                            <TouchableOpacity
                                key={icon}
                                style={[
                                    styles.iconButton,
                                    selectedIcon === icon && { backgroundColor: selectedColor }
                                ]}
                                onPress={() => setSelectedIcon(icon)}
                            >
                                <Ionicons
                                    name={icon as any}
                                    size={24}
                                    color={selectedIcon === icon ? '#FFF' : '#6B7280'}
                                />
                            </TouchableOpacity>
                        ))}
                    </View>
                    <View style={styles.grid}>
                        {COLORS.map((color) => (
                            <TouchableOpacity
                                key={color}
                                style={[
                                    styles.colorButton,
                                    { backgroundColor: color },
                                    selectedColor === color && styles.selectedColorButton
                                ]}
                                onPress={() => setSelectedColor(color)}
                            />
                        ))}
                    </View>
                </View>

                <View style={styles.section}>
                    <View style={styles.switchRow}>
                        <Text style={styles.label}>Enable Stock Tracking</Text>
                        <TouchableOpacity
                            onPress={() => setStockEnabled(!stockEnabled)}
                            style={[styles.checkbox, stockEnabled && styles.checkboxChecked]}
                        >
                            {stockEnabled && <Ionicons name="checkmark" size={16} color="#FFF" />}
                        </TouchableOpacity>
                    </View>

                    {stockEnabled && (
                        <View style={styles.stockInputs}>
                            <TextInput
                                style={[styles.input, { flex: 1, marginRight: 8 }]}
                                placeholder="Current Qty"
                                keyboardType="numeric"
                                value={stockQuantity}
                                onChangeText={setStockQuantity}
                            />
                            <TextInput
                                style={[styles.input, { flex: 1 }]}
                                placeholder="Low Threshold"
                                keyboardType="numeric"
                                value={stockThreshold}
                                onChangeText={setStockThreshold}
                            />
                        </View>
                    )}

                    {stockEnabled && (
                        <View style={{ marginTop: 12 }}>
                            <Text style={styles.label}>Daily Refill Reminder Time</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="HH:mm (e.g. 09:00)"
                                value={refillReminderTime}
                                onChangeText={setRefillReminderTime}
                            />
                            <Text style={styles.helpText}>We'll nudge you at this time if stock is low.</Text>
                        </View>
                    )}
                </View>

                <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                    <Text style={styles.saveButtonText}>{isEditing ? 'Update Medication' : 'Save Medication'}</Text>
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFF',
    },
    scrollContent: {
        padding: 24,
    },
    section: {
        marginBottom: 24,
    },
    label: {
        fontSize: 14,
        fontFamily: 'OutfitBold',
        color: '#374151',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    helpText: {
        fontSize: 12,
        fontFamily: 'Outfit',
        color: '#6B7280',
        marginTop: 4,
        marginLeft: 4,
    },
    input: {
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        fontFamily: 'Outfit',
        color: '#111827',
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 8,
    },
    iconButton: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: '#F3F4F6',
        justifyContent: 'center',
        alignItems: 'center',
    },
    colorButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
    },
    selectedColorButton: {
        borderWidth: 3,
        borderColor: '#D1D5DB',
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#D1D5DB',
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkboxChecked: {
        backgroundColor: '#4F46E5',
        borderColor: '#4F46E5',
    },
    stockInputs: {
        flexDirection: 'row',
    },
    saveButton: {
        backgroundColor: '#4F46E5',
        borderRadius: 16,
        padding: 18,
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 40,
    },
    saveButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontFamily: 'OutfitBold',
    },
});
