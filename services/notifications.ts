import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

export async function getNotificationStatusAsync() {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
}

export async function setupNotificationsAsync() {
    // Check permission first
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.log('Failed to get notification permissions');
    }

    // Always setup the channel for local notifications on Android
    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
        });
    }

    return finalStatus;
}

function parseTime(time: string): { hour: number; minute: number } | null {
    if (!time) return null;
    
    // Trim and normalize whitespace
    const t = time.trim();
    
    // Handle 12-hour format (e.g., "09:58 AM", "8:00 PM")
    const ampmMatch = t.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (ampmMatch) {
        let hour = parseInt(ampmMatch[1], 10);
        const minute = parseInt(ampmMatch[2], 10);
        const period = ampmMatch[3].toUpperCase();
        
        if (period === 'PM' && hour < 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;
        
        return { hour, minute };
    }
    
    // Handle 24-hour format (e.g., "14:30")
    const parts = t.split(':');
    if (parts.length >= 2) {
        const hour = parseInt(parts[0], 10);
        const minute = parseInt(parts[1], 10);
        if (!isNaN(hour) && !isNaN(minute)) {
            return { hour, minute };
        }
    }
    
    return null;
}

export async function scheduleMedicationReminder(id: number, name: string, time: string) {
    const parsed = parseTime(time);
    
    if (!parsed) {
        console.warn(`Invalid time format for medication ${id}: ${time}`);
        return;
    }

    const { hour, minute } = parsed;
    const identifier = `reminder-${id}`;
    
    await Notifications.dismissNotificationAsync(identifier).catch(() => {});
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});

    try {
        const trigger: any = {
            hour,
            minute,
            repeats: true,
        };

        await Notifications.scheduleNotificationAsync({
            identifier,
            content: {
                title: `${name} Reminder 💊`,
                body: `It's time for your ${time} dose!`,
                data: { medicationId: id },
                channelId: Platform.OS === 'android' ? 'default' : undefined,
                sound: true,
                priority: Notifications.AndroidNotificationPriority.MAX,
            } as any,
            trigger,
        });
        console.log(`Scheduled daily reminder for ${name} at ${hour}:${minute} (ID: ${identifier})`);
    } catch (error) {
        console.error(`Failed to schedule reminder for ${name}:`, error);
    }
}

export async function getScheduledNotificationsInfo() {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.map(n => {
        const trigger: any = n.trigger;
        let timeLabel = 'Unknown';
        
        if (trigger) {
            if (trigger.hour !== undefined) {
                const h = trigger.hour;
                const m = trigger.minute;
                const period = h >= 12 ? 'PM' : 'AM';
                const h12 = h % 12 || 12;
                timeLabel = `${h12}:${m.toString().padStart(2, '0')} ${period}`;
            } else if (trigger.seconds !== undefined) {
                timeLabel = `In ${trigger.seconds}s`;
            }
        }
        
        return {
            id: n.identifier,
            title: n.content.title,
            time: timeLabel,
            trigger
        };
    });
}

export async function cancelMedicationNotifications(id: number) {
    await Notifications.cancelScheduledNotificationAsync(`reminder-${id}`).catch(() => {});
    await Notifications.cancelScheduledNotificationAsync(`refill-${id}`).catch(() => {});
}

export async function showImmediateNotification(title: string, body: string, data?: any) {
    await Notifications.scheduleNotificationAsync({
        content: {
            title,
            body,
            data,
            sound: true,
            priority: Notifications.AndroidNotificationPriority.HIGH,
            channelId: Platform.OS === 'android' ? 'default' : undefined,
        } as any,
        trigger: null, // Immediate
    });
}

export async function rescheduleAllNotifications(meds: any[], stockItems: any[]) {
    // 1. Cancel everything first to start clean (safer)
    await Notifications.cancelAllScheduledNotificationsAsync();
    
    // 2. Schedule each medication
    for (const med of meds) {
        await scheduleMedicationReminder(med.id, med.name, med.time);
        
        if (med.stockEnabled) {
            const stock = stockItems.find(s => s.medicationId === med.id);
            if (stock && stock.quantity <= stock.threshold && stock.refillReminderTime) {
                await scheduleDailyRefillReminder(med.id, med.name, stock.refillReminderTime);
            }
        }
    }
}

export async function testImmediateNotification() {
    await Notifications.scheduleNotificationAsync({
        content: {
            title: "Test Notification Success! ✅",
            body: "If you see this, your notifications are working perfectly.",
            channelId: Platform.OS === 'android' ? 'default' : undefined,
        } as any,
        trigger: null, // Send immediately
    });
}

export async function scheduleTestNotification(name: string, seconds: number) {
    await Notifications.scheduleNotificationAsync({
        content: {
            title: `Reminder for ${name} 💊`,
            body: `It's time to take your medicine!`,
            channelId: Platform.OS === 'android' ? 'default' : undefined,
        } as any,
        trigger: {
            seconds,
            repeats: false,
        } as any,
    });
}

export async function scheduleLowStockNotification(name: string, quantity: number) {
    const isEmpty = quantity <= 0;
    await Notifications.scheduleNotificationAsync({
        content: {
            title: isEmpty ? `${name} Empty! ❌` : `Low Stock: ${name} ⚠️`,
            body: isEmpty 
                ? `You have run out of ${name}. Please refill immediately.`
                : `You only have ${quantity} units left. Please refill soon.`,
            data: { type: 'low-stock', isEmpty },
            channelId: Platform.OS === 'android' ? 'default' : undefined,
        } as any,
        trigger: null, // Send immediately
    });
}

export async function scheduleDailyRefillReminder(id: number, name: string, time: string) {
    const parsed = parseTime(time);
    
    if (!parsed) {
        console.warn(`Invalid refill reminder time for medication ${id}: ${time}`);
        return;
    }

    const { hour, minute } = parsed;
    const identifier = `refill-${id}`;

    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});

    try {
        await Notifications.scheduleNotificationAsync({
            identifier,
            content: {
                title: "Stock Alert: Buy More! 🛒",
                body: `You are running low on ${name}. Please refill soon.`,
                data: { type: 'refill-reminder', medicationId: id },
                channelId: Platform.OS === 'android' ? 'default' : undefined,
                sound: true,
            } as any,
            trigger: {
                hour,
                minute,
                repeats: true,
            } as any,
        });
        console.log(`Successfully scheduled refill reminder for ${name} at ${hour}:${minute}`);
    } catch (error) {
        console.error(`Failed to schedule refill reminder for ${name}:`, error);
    }
}

