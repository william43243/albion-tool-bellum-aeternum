import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { Language } from '../lib/i18n';

type Notice = { label: string; text: string; source: string };
type Entry = { id: string; name: string; version: string; license: string; notices: Notice[] };
type Bundle = { entries: Entry[]; texts: Record<string, string> };

export default function ThirdPartyNotices({ lang }: { lang: Language }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [query, setQuery] = useState('');
  const label = (fr: string, en: string, es: string) => lang === 'fr' ? fr : lang === 'es' ? es : en;
  const entries = useMemo(() => bundle?.entries.filter(entry =>
    `${entry.name} ${entry.license}`.toLowerCase().includes(query.toLowerCase())) ?? [], [bundle, query]);
  const pages = useMemo(() => {
    if (!selected || !bundle) return [];
    return selected.notices.flatMap((notice, index) => {
      const text = `${notice.label}\n${notice.source}\n\n${bundle.texts[notice.text]}`;
      // Virtualize large upstream notices (LiteRT alone exceeds 2 MB).
      const chunks: { id: string; text: string }[] = [];
      for (let start = 0; start < text.length; start += 6000) {
        chunks.push({ id: `${index}-${start}`, text: text.slice(start, start + 6000) });
      }
      return chunks;
    });
  }, [bundle, selected]);
  const close = () => { setVisible(false); setSelected(null); setQuery(''); };
  return <>
    <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => {
      // Keep the full legal corpus out of the initial screen render.
      if (!bundle) setBundle(require('../assets/legal/third-party-notices.json') as Bundle);
      setVisible(true);
    }}>
      <Text style={styles.buttonText}>{label('Licences et crédits', 'Licenses and credits', 'Licencias y créditos')}</Text>
    </TouchableOpacity>
    <Modal visible={visible} animationType="slide" onRequestClose={() => selected ? setSelected(null) : close()}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          {selected && <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => setSelected(null)}>
            <Text style={styles.buttonText}>{label('Retour', 'Back', 'Volver')}</Text>
          </TouchableOpacity>}
          <Text style={styles.title}>{selected?.name ?? label('Licences et crédits', 'Licenses and credits', 'Licencias y créditos')}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={close}>
            <Text style={styles.buttonText}>{label('Fermer', 'Close', 'Cerrar')}</Text>
          </TouchableOpacity>
        </View>
        {selected ? <FlatList key={selected.id} data={pages} keyExtractor={item => item.id}
          initialNumToRender={2} maxToRenderPerBatch={3} windowSize={5}
          contentContainerStyle={styles.content}
          renderItem={({ item }) => <Text selectable style={styles.legal}>{item.text}</Text>} /> : <>
          <Text style={styles.description}>{label(
            'Textes tiers conservés hors ligne. Prix : Albion Online Data Project. Catalogue et carte : ao-data/ao-bin-dumps. Albion Online appartient à Sandbox Interactive; application indépendante, sans affiliation. Les modèles téléchargés ont leurs propres licences.',
            'Third-party notices available offline. Prices: Albion Online Data Project. Catalog and map: ao-data/ao-bin-dumps. Albion Online belongs to Sandbox Interactive; this independent app is not affiliated. Downloaded models have separate licenses.',
            'Avisos de terceros disponibles sin conexión. Precios: Albion Online Data Project. Catálogo y mapa: ao-data/ao-bin-dumps. Albion Online pertenece a Sandbox Interactive; aplicación independiente sin afiliación. Los modelos descargados tienen licencias propias.')}</Text>
          <TextInput style={styles.search} value={query} onChangeText={setQuery} autoCorrect={false}
            accessibilityLabel={label('Rechercher une licence', 'Search licenses', 'Buscar licencias')}
            placeholder={label('Rechercher un composant…', 'Search components…', 'Buscar componentes…')}
            placeholderTextColor={COLORS.textSecondary} />
          <FlatList data={entries} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            ListEmptyComponent={<Text style={styles.description}>{label('Aucun résultat', 'No results', 'Sin resultados')}</Text>}
            renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => setSelected(item)}>
              <Text style={styles.name}>{item.name} {item.version}</Text>
              <Text style={styles.description}>{item.license}</Text>
            </TouchableOpacity>} />
        </>}
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  button: { padding: 16, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginVertical: 12 },
  buttonText: { color: COLORS.primary, fontSize: 15, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  action: { padding: 12, minHeight: 48, justifyContent: 'center' },
  title: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '600', padding: 8 },
  content: { padding: 16, paddingBottom: 32 },
  description: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, margin: 8 },
  search: { color: COLORS.text, backgroundColor: COLORS.surface, borderRadius: 8, padding: 14, margin: 16 },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  name: { color: COLORS.text, fontSize: 15, marginHorizontal: 8 },
  legal: { color: COLORS.text, fontSize: 13, lineHeight: 20, marginBottom: 16 },
});
