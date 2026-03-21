import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

export default function TabLayout() {
    const colorScheme = useColorScheme();

    return (
        <Tabs
            screenOptions={{
                tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
                headerShown: true,
                tabBarStyle: {
                    backgroundColor: colorScheme === 'dark' ? '#121212' : '#FFFFFF',
                    borderTopWidth: 0,
                    elevation: 0,
                    height: 60,
                    paddingBottom: 10,
                },
                headerStyle: {
                    backgroundColor: colorScheme === 'dark' ? '#121212' : '#FFFFFF',
                    elevation: 0,
                    shadowOpacity: 0,
                },
                headerTitleStyle: {
                    fontFamily: 'OutfitBold',
                    fontSize: 20,
                },
            }}>
            <Tabs.Screen
                name="index"
                options={{
                    title: 'Schedule',
                    tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
                }}
            />
            <Tabs.Screen
                name="history"
                options={{
                    title: 'History',
                    tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" size={size} color={color} />,
                }}
            />
            <Tabs.Screen
                name="stock"
                options={{
                    title: 'Stock',
                    tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color} />,
                }}
            />
        </Tabs>
    );
}
