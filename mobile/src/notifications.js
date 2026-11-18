import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Show the notification even when the app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Asks for permission and returns this phone's Expo push token.
 * Throws an Error with a readable message if it can't.
 */
export async function registerForPushNotifications() {
  if (Platform.OS === 'android') {
    // Must match "channelId" sent by the backend
    await Notifications.setNotificationChannelAsync('soil-alerts', {
      name: 'Soil moisture alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2E7D32',
    });
  }

  if (!Device.isDevice) {
    throw new Error('Push notifications need a physical phone (not an emulator).');
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  if (!projectId) {
    throw new Error('EAS projectId missing. Run "npx eas init" in the mobile folder.');
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  return token;
}
