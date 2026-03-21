import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

export async function getNotificationStatusAsync() {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
}

export async function setupNotificationsAsync() {
    // Expo Go SDK 54+ has removed remote push notification support.
    // We only need local notifications for this app.
    if (isExpoGo && Platform.OS === 'android') {
        console.log('Running in Expo Go: Skipping push-specific setup');
        await Notifications.requestPermissionsAsync();
        return;
    }

    const { status } = await Notifications.requestPermissionsAsync();

    if (status !== "granted") {
        console.log("Notification permission not granted");
    }

    if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.MAX,
        });
    }
}

export async function scheduleMedicationReminder(id: number, name: string, time: string) {
    const [hours, minutes] = time.split(":").map(Number);

    await Notifications.scheduleNotificationAsync({
        content: {
            title: "Time for your medicine 💊",
            body: `Don't forget to take ${name}`,
            data: { medicationId: id },
        },
        trigger: {
            hour: hours,
            minute: minutes,
            repeats: true,
            channelId: Platform.OS === 'android' ? 'default' : undefined,
        } as any,
    });
}

export async function cancelAllNotifications() {
    await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function scheduleLowStockNotification(name: string, quantity: number) {
    await Notifications.scheduleNotificationAsync({
        content: {
            title: "Low Stock Alert ⚠️",
            body: `You only have ${quantity} units of ${name} left. Please refill soon.`,
            data: { type: 'low-stock' },
        },
        trigger: null, // Send immediately
    });
}

export async function scheduleDailyRefillReminder(name: string, time: string) {
    const [hours, minutes] = time.split(":").map(Number);

    await Notifications.scheduleNotificationAsync({
        content: {
            title: "Refill Reminder 🛒",
            body: `Your stock for ${name} is low. Don't forget to buy more!`,
            data: { type: 'refill-reminder' },
        },
        trigger: {
            hour: hours,
            minute: minutes,
            repeats: true,
            channelId: Platform.OS === 'android' ? 'default' : undefined,
        } as any,
    });
}