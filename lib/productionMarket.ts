import AsyncStorage from '@react-native-async-storage/async-storage';
import { marketFetch } from './marketTransport';
import { createProductionMarketClient } from './productionMarketClient';

export const productionMarket = createProductionMarketClient(AsyncStorage, marketFetch);
export type { ProductionMarketQuery, ProductionMarketResult, ProductionMarketRow, ProductionQuote, ProductionHistoryQuery, ProductionHistoryResult } from './productionMarketClient';
