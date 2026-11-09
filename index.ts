import { registerRootComponent } from 'expo';
import { NativeModules, Platform } from 'react-native';
import { configureMarketTransport } from './lib/marketTransport';

import App from './App';

configureMarketTransport(Platform.OS === 'android', NativeModules.MarketTransport);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
