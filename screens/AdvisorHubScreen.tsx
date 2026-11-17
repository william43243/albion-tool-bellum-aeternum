import React, { useEffect, useState } from 'react';
import { BackHandler, Keyboard, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AdvisorScreen from './AdvisorScreen';
import OpenAIChatScreen from './OpenAIChatScreen';
import { COLORS } from '../constants/theme';

type Props = React.ComponentProps<typeof AdvisorScreen> & { active?: boolean; compact?: boolean; onProviderChange?: (provider: 'local' | 'openai') => void; onBackToSections: () => void };
export default function AdvisorHubScreen({ active = true, compact = false, onProviderChange, onBackToSections, ...props }: Props) {
  const [provider, setProvider] = useState<'local' | 'openai'>('openai');
  const [visitedCloud, setVisitedCloud] = useState(false);
  useEffect(() => { if (active && provider === 'openai') setVisitedCloud(true); }, [active, provider]);
  useEffect(() => { onProviderChange?.(provider); }, [provider, onProviderChange]);
  useEffect(() => {
    if (!active || provider !== 'openai' || compact) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { Keyboard.dismiss(); onBackToSections(); return true; });
    return () => subscription.remove();
  }, [active, provider, compact, onBackToSections]);
  const changeProvider = (next: 'local' | 'openai') => { Keyboard.dismiss(); setProvider(next); };
  const french = props.lang === 'fr';
  const spanish = props.lang === 'es';
  return <View style={styles.root}>
    <View style={[styles.tabs, compact && styles.hidden]} accessibilityRole="tablist">
      <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: provider === 'openai' }} style={[styles.tab, provider === 'openai' && styles.selected]} onPress={() => { setVisitedCloud(true); changeProvider('openai'); }}>
        <Text style={[styles.label, provider === 'openai' && styles.selectedText]}>{french ? 'Agent OpenAI' : spanish ? 'Agente OpenAI' : 'OpenAI agent'}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: provider === 'local' }} style={[styles.tab, provider === 'local' && styles.selected]} onPress={() => changeProvider('local')}>
        <Text style={[styles.label, provider === 'local' && styles.selectedText]}>{french ? 'Sur cet appareil' : spanish ? 'En este dispositivo' : 'On this device'}</Text>
      </TouchableOpacity>
    </View>
    <View style={[styles.root, provider !== 'local' && styles.hidden]}><AdvisorScreen {...props} /></View>
    {visitedCloud && <View style={[styles.root, provider !== 'openai' && styles.hidden]}><OpenAIChatScreen compact={compact} onBack={onBackToSections} playerCity={props.playerCity} isPremium={props.isPremium} lang={props.lang} server={props.server} active={active && provider === 'openai'} /></View>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, hidden: { display: 'none' },
  tabs: { flexDirection: 'row', padding: 8, gap: 8, backgroundColor: COLORS.background },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  selected: { backgroundColor: COLORS.primarySoft, borderColor: COLORS.border, borderBottomColor: COLORS.primary, borderBottomWidth: 3 },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' }, selectedText: { color: COLORS.primaryLight },
});
