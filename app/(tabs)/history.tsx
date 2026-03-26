import { useDatabase } from '@/hooks/useDatabase';
import { getLogs, getLogsByRange, logMedication, Medication, MedicationLog } from '@/services/db';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { format, subDays } from 'date-fns';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function HistoryScreen() {
    const { medications, isReady } = useDatabase();
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [logs, setLogs] = useState<MedicationLog[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    const stats = useMemo(() => {
        const total = medications.length;
        if (total === 0) return { taken: 0, skipped: 0, total: 0, completion: 0 };
        
        const taken = logs.filter(l => l.status === 'taken').length;
        const skipped = logs.filter(l => l.status === 'skipped').length;
        const completion = (taken / total) * 100;
        
        return { taken, skipped, total, completion };
    }, [logs, medications]);

    const days = useMemo(() => {
        return Array.from({ length: 7 }, (_, i) => subDays(new Date(), i));
    }, []);

    const loadLogs = useCallback(async () => {
        if (!isReady) return;
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const dayLogs = await getLogs(dateStr);
        setLogs(dayLogs);
    }, [selectedDate, isReady]);

    useFocusEffect(
        useCallback(() => {
            if (isReady) {
                loadLogs();
            }
        }, [loadLogs, isReady])
    );

    const handleWeeklyReport = async () => {
        const endDate = new Date();
        const startDate = subDays(endDate, 6); // Past 7 days
        const rangeLogs = await getLogsByRange(format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'));

        if (rangeLogs.length === 0) {
            Alert.alert('No Data', 'No medication activity recorded in the last 7 days.');
            return;
        }

        const totalExpected = medications.length * 7;
        const totalTaken = rangeLogs.filter(l => l.status === 'taken').length;
        const totalSkipped = rangeLogs.filter(l => l.status === 'skipped').length;
        const adherence = totalExpected > 0 ? Math.round((totalTaken / totalExpected) * 100) : 0;

        const medBreakdown = medications.map(med => {
            const medLogs = rangeLogs.filter(l => l.medicationId === med.id);
            const takenCount = medLogs.filter(l => l.status === 'taken').length;
            return `- ${med.name}: ${takenCount}/7 days taken`;
        }).join('\n');

        const message = `Weekly Medication Adherence Report\n` +
            `Range: ${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}\n\n` +
            `Overall Adherence: ${adherence}%\n` +
            `Total Taken: ${totalTaken}\n` +
            `Total Skipped: ${totalSkipped}\n\n` +
            `Medication Breakdown:\n${medBreakdown}\n\n` +
            `Generated via Medicine App`;

        try {
            await Share.share({
                title: 'Weekly Adherence Report',
                message,
            });
        } catch (error) {
            console.error(error);
            Alert.alert('Error', 'Failed to share report');
        }
    };

    const handleShare = async () => {
        if (logs.length === 0) {
            Alert.alert('No Data', 'There are no logs to share for this date.');
            return;
        }

        const dateStr = format(selectedDate, 'EEEE, MMMM do');
        const logLines = logs.map(log => {
            const med = medications.find(m => m.id === log.medicationId);
            return `- ${log.time}: ${med?.name || 'Unknown'} (${log.status})`;
        }).join('\n');

        const message = `Medication History for ${dateStr}:\n\nTotal Scheduled: ${stats.total}\nTaken: ${stats.taken}\nSkipped: ${stats.skipped}\nAdherence: ${Math.round(stats.completion)}%\n\nActivities:\n${logLines}`;

        try {
            await Share.share({
                title: `Medication History - ${dateStr}`,
                message,
            });
        } catch (error) {
            console.error(error);
            Alert.alert('Error', 'Failed to share history');
        }
    };

    const handleMark = async (med: Medication, status: 'taken' | 'skipped') => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await logMedication({
            medicationId: med.id,
            date: format(selectedDate, 'yyyy-MM-dd'),
            time: format(new Date(), 'HH:mm'),
            status,
        });
        loadLogs();
    };

    const renderLog = ({ item }: { item: Medication }) => {
        const log = logs.find(l => l.medicationId === item.id);
        const isDone = !!log;
        const status = log?.status;

        return (
            <View style={[styles.logCard, isDone && styles.logCardDone]}>
                <View style={[styles.statusIndicator, { backgroundColor: isDone ? (status === 'taken' ? '#10B981' : '#EF4444') : '#D1D5DB' }]} />
                <View style={styles.logInfo}>
                    <Text style={styles.medName}>{item.name}</Text>
                    <Text style={styles.logDetails}>{item.dosage} • {item.time}</Text>
                </View>

                {isDone ? (
                    <TouchableOpacity 
                        style={styles.markButtons}
                        onPress={() => {
                            // If they click the status, let them change it. 
                            // For simplicity, we'll just show the buttons again by having a state or just allowing it.
                            // Actually, let's just show the buttons again but highlight the current one.
                        }}
                    >
                        <TouchableOpacity
                            style={[
                                styles.smallMarkButton, 
                                styles.skipButton,
                                status === 'skipped' && { backgroundColor: '#FEE2E2' }
                            ]}
                            onPress={() => handleMark(item, 'skipped')}
                        >
                            <Ionicons name="close" size={16} color={status === 'skipped' ? '#EF4444' : '#6B7280'} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.smallMarkButton, 
                                styles.takeButton,
                                status === 'taken' && { backgroundColor: '#10B981' },
                                status !== 'taken' && { backgroundColor: '#F3F4F6' }
                            ]}
                            onPress={() => handleMark(item, 'taken')}
                        >
                            <Ionicons name="checkmark" size={16} color={status === 'taken' ? '#FFF' : '#6B7280'} />
                        </TouchableOpacity>
                    </TouchableOpacity>
                ) : (
                    <View style={styles.markButtons}>
                        <TouchableOpacity
                            style={[styles.smallMarkButton, styles.skipButton]}
                            onPress={() => {
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                handleMark(item, 'skipped');
                            }}
                        >
                            <Ionicons name="close" size={16} color="#6B7280" />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.smallMarkButton, styles.takeButton]}
                            onPress={() => {
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                handleMark(item, 'taken');
                            }}
                        >
                            <Ionicons name="checkmark" size={16} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    };

    const filteredMedications = medications.filter(med => 
        med.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <View style={styles.headerInfo}>
                        <Text style={styles.title}>History</Text>
                        <Text style={styles.subtitle}>Activity Logs</Text>
                    </View>
                    <View style={styles.headerButtons}>
                        <TouchableOpacity style={[styles.headerButton, styles.shareBtn]} onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            handleShare();
                        }}>
                            <Ionicons name="share-outline" size={18} color="#6366F1" />
                            <Text style={styles.shareBtnText}>Share</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.headerButton, styles.reportBtn]} onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            handleWeeklyReport();
                        }}>
                            <Ionicons name="analytics-outline" size={18} color="#10B981" />
                            <Text style={styles.reportBtnText}>Report</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Search Bar - Extra Feature */}
                <View style={styles.searchContainer}>
                    <Ionicons name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search logs..."
                        placeholderTextColor="#9CA3AF"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={20} color="#9CA3AF" />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            <View style={styles.dateSelector}>
                <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={days}
                    keyExtractor={(item) => item.toISOString()}
                    renderItem={({ item }) => {
                        const isSelected = format(item, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                        return (
                            <TouchableOpacity
                                style={[styles.dateItem, isSelected && styles.dateItemSelected]}
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    setSelectedDate(item);
                                }}
                            >
                                <Text style={[styles.dayText, isSelected && styles.whiteText]}>{format(item, 'EEE')}</Text>
                                <Text style={[styles.dateText, isSelected && styles.whiteText]}>{format(item, 'd')}</Text>
                            </TouchableOpacity>
                        );
                    }}
                    contentContainerStyle={styles.dateList}
                />
            </View>

            <FlatList
                data={filteredMedications}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderLog}
                contentContainerStyle={styles.list}
                ListHeaderComponent={
                    <View style={styles.summaryCard}>
                        <View style={styles.summaryHeader}>
                            <Text style={styles.summaryTitle}>Daily Summary</Text>
                            <Text style={styles.summaryDate}>{format(selectedDate, 'MMM d, yyyy')}</Text>
                        </View>
                        <View style={styles.statsRow}>
                            <View style={styles.statItem}>
                                <Text style={styles.statValue}>{stats.taken}</Text>
                                <Text style={styles.statLabel}>Taken</Text>
                            </View>
                            <View style={[styles.statItem, styles.statBorder]}>
                                <Text style={styles.statValue}>{stats.skipped}</Text>
                                <Text style={styles.statLabel}>Skipped</Text>
                            </View>
                            <View style={styles.statItem}>
                                <Text style={styles.statValue}>{Math.round(stats.completion)}%</Text>
                                <Text style={styles.statLabel}>Adherence</Text>
                            </View>
                        </View>
                        <View style={styles.progressContainer}>
                            <View style={[styles.progressBar, { width: `${Math.min(stats.completion, 100)}%` }]} />
                        </View>
                    </View>
                }
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="receipt-outline" size={64} color="#9CA3AF" />
                        <Text style={styles.emptyStateText}>No activity for this day.</Text>
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
        paddingHorizontal: 20,
        paddingTop: 64,
        paddingBottom: 20,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    headerInfo: {
        flex: 1,
    },
    title: {
        fontSize: 32,
        fontFamily: 'OutfitBold',
        color: '#111827',
    },
    subtitle: {
        fontSize: 15,
        color: '#6B7280',
        fontFamily: 'Outfit',
        marginTop: 4,
    },
    headerButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    headerButton: {
        flexDirection: 'column',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 12,
        gap: 2,
        borderWidth: 1.5,
        minWidth: 56,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
        borderRadius: 16,
        paddingHorizontal: 12,
        height: 48,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        fontFamily: 'Outfit',
        color: '#111827',
    },
    shareBtn: {
        backgroundColor: '#EEF2FF',
        borderColor: '#C7D2FE',
    },
    shareBtnText: {
        fontSize: 12,
        color: '#6366F1',
        fontFamily: 'OutfitBold',
    },
    reportBtn: {
        backgroundColor: '#ECFDF5',
        borderColor: '#A7F3D0',
    },
    reportBtnText: {
        fontSize: 12,
        color: '#10B981',
        fontFamily: 'OutfitBold',
    },
    dateSelector: {
        backgroundColor: '#FFF',
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    dateList: {
        paddingHorizontal: 20,
    },
    dateItem: {
        width: 60,
        height: 70,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 16,
        marginRight: 12,
        backgroundColor: '#F3F4F6',
    },
    dateItemSelected: {
        backgroundColor: '#4F46E5',
    },
    dayText: {
        fontSize: 12,
        fontFamily: 'Outfit',
        color: '#6B7280',
        textTransform: 'uppercase',
    },
    dateText: {
        fontSize: 20,
        fontFamily: 'OutfitBold',
        color: '#111827',
        marginTop: 4,
    },
    whiteText: {
        color: '#FFF',
    },
    list: {
        padding: 20,
        paddingTop: 8,
    },
    summaryCard: {
        backgroundColor: '#6366F1',
        borderRadius: 28,
        padding: 24,
        marginBottom: 24,
        elevation: 12,
        shadowColor: '#6366F1',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 20,
    },
    summaryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    summaryTitle: {
        fontSize: 18,
        fontFamily: 'OutfitBold',
        color: '#FFF',
    },
    summaryDate: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.8)',
        fontFamily: 'Outfit',
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
    },
    statBorder: {
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    statValue: {
        fontSize: 20,
        fontFamily: 'OutfitBold',
        color: '#FFF',
    },
    statLabel: {
        fontSize: 12,
        color: 'rgba(255, 255, 255, 0.8)',
        fontFamily: 'Outfit',
        marginTop: 4,
    },
    progressContainer: {
        height: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressBar: {
        height: '100%',
        backgroundColor: '#10B981',
        borderRadius: 3,
    },
    logCard: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        gap: 16,
    },
    logCardDone: {
        opacity: 0.8,
        backgroundColor: '#F9FAFB',
    },
    statusIndicator: {
        width: 4,
        height: 32,
        borderRadius: 2,
    },
    logInfo: {
        flex: 1,
    },
    medName: {
        fontSize: 16,
        fontFamily: 'OutfitBold',
        color: '#111827',
    },
    logDetails: {
        fontSize: 13,
        color: '#6B7280',
        marginTop: 2,
    },
    statusText: {
        fontSize: 14,
        fontFamily: 'OutfitBold',
    },
    markButtons: {
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
    },
    smallMarkButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 8,
    },
    takeButton: {
        backgroundColor: '#10B981',
    },
    skipButton: {
        backgroundColor: '#F3F4F6',
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
});
