import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import { calculateFlippingProfit, RecipeMaterial } from '../lib/calculations';
import { Language } from '../lib/i18n';
import { trackFlipCalculation } from '../lib/analytics';
import NumberInput from '../components/NumberInput';
import PremiumToggle from '../components/PremiumToggle';
import ResultCard from '../components/ResultCard';

interface Props {
  t: (key: any) => any;
  lang: Language;
  isPremium: boolean;
  onPremiumChange: (value: boolean) => void;
}

interface MaterialState {
  id: number;
  unitPrice: string;
  requiredQuantity: string;
  useBuyOrder: boolean;
}

const initialMaterial = (id: number): MaterialState => ({
  id,
  unitPrice: '',
  requiredQuantity: '1',
  useBuyOrder: false,
});

export default function FlippingScreen({ t, lang, isPremium, onPremiumChange }: Props) {
  const [materials, setMaterials] = useState<MaterialState[]>([initialMaterial(1)]);
  const [nextMaterialId, setNextMaterialId] = useState(2);
  const [productSellPrice, setProductSellPrice] = useState('');
  const [craftingItemValue, setCraftingItemValue] = useState('');
  const [stationTax, setStationTax] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [resourceReturnPercent, setResourceReturnPercent] = useState('0');
  const [useSellOrder, setUseSellOrder] = useState(false);

  const updateMaterial = (id: number, patch: Partial<MaterialState>) => {
    setMaterials((current) => current.map((material) => (
      material.id === id ? { ...material, ...patch } : material
    )));
  };

  const addMaterial = () => {
    if (materials.length >= 8) return;
    setMaterials((current) => [...current, initialMaterial(nextMaterialId)]);
    setNextMaterialId((value) => value + 1);
  };

  const removeMaterial = (id: number) => {
    setMaterials((current) => current.length > 1
      ? current.filter((material) => material.id !== id)
      : current);
  };

  const result = useMemo(() => {
    const recipe: RecipeMaterial[] = materials.map((material) => ({
      unitPrice: parseFloat(material.unitPrice) || 0,
      requiredQuantity: parseFloat(material.requiredQuantity) || 0,
      useBuyOrder: material.useBuyOrder,
    }));
    const prodSell = parseFloat(productSellPrice) || 0;
    const craftIV = parseFloat(craftingItemValue) || 0;
    const tax = parseFloat(stationTax) || 0;
    const qty = parseInt(quantity, 10) || 1;
    const returnRate = (parseFloat(resourceReturnPercent) || 0) / 100;
    if (recipe.every((material) => material.unitPrice <= 0) && prodSell <= 0) return null;
    return calculateFlippingProfit(
      recipe,
      prodSell,
      craftIV,
      tax,
      qty,
      isPremium,
      useSellOrder,
      returnRate
    );
  }, [materials, productSellPrice, craftingItemValue, stationTax, quantity, isPremium, useSellOrder, resourceReturnPercent]);

  const trackedFirstValidRef = useRef(false);
  useEffect(() => {
    if (!result) {
      trackedFirstValidRef.current = false;
      return;
    }
    if (trackedFirstValidRef.current) return;
    const id = setTimeout(() => {
      trackFlipCalculation();
      trackedFirstValidRef.current = true;
    }, 1000);
    return () => clearTimeout(id);
  }, [result]);

  const copy = {
    materials: lang === 'fr' ? '1. Recette et achat des matériaux' : lang === 'es' ? '1. Receta y compra de materiales' : '1. Recipe and material purchases',
    ingredient: lang === 'fr' ? 'Ingrédient' : lang === 'es' ? 'Ingrediente' : 'Ingredient',
    required: lang === 'fr' ? 'Quantité requise par craft' : lang === 'es' ? 'Cantidad por craft' : 'Required per craft',

    add: lang === 'fr' ? '+ Ajouter un ingrédient' : lang === 'es' ? '+ Añadir ingrediente' : '+ Add ingredient',
    remove: lang === 'fr' ? 'Retirer' : lang === 'es' ? 'Quitar' : 'Remove',
    returnRate: lang === 'fr' ? 'Retour de ressources (%)' : lang === 'es' ? 'Retorno de recursos (%)' : 'Resource return (%)',
    returnInfo: lang === 'fr' ? 'Paramètre explicite, indépendant de Premium' : lang === 'es' ? 'Parámetro explícito, independiente de Premium' : 'Explicit parameter, independent from Premium',

  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('flipping')}</Text>
      <View style={styles.infoBox}><Text style={styles.infoText}>{t('flippingInfo')}</Text></View>
      <PremiumToggle
        isPremium={isPremium}
        onToggle={onPremiumChange}
        labelOn={t('premium')}
        labelOff={t('nonPremium')}
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{copy.materials}</Text>
        {materials.map((material, index) => (
          <View key={material.id} style={styles.materialCard}>
            <View style={styles.materialHeader}>
              <Text style={styles.materialTitle}>{copy.ingredient} {index + 1}</Text>
              {materials.length > 1 && (
                <TouchableOpacity onPress={() => removeMaterial(material.id)}>
                  <Text style={styles.removeText}>{copy.remove}</Text>
                </TouchableOpacity>
              )}
            </View>
            <NumberInput
              label={t('materialCost')}
              value={material.unitPrice}
              onChangeText={(value) => updateMaterial(material.id, { unitPrice: value })}
              info={lang === 'fr' ? 'Prix unitaire' : 'Unit price'}
            />
            <NumberInput
              label={copy.required}
              value={material.requiredQuantity}
              onChangeText={(value) => updateMaterial(material.id, { requiredQuantity: value })}
            />
            <TouchableOpacity
              style={[styles.orderBtn, material.useBuyOrder && styles.orderBtnActive]}
              onPress={() => updateMaterial(material.id, { useBuyOrder: !material.useBuyOrder })}
            >
              <Text style={[styles.orderBtnText, material.useBuyOrder && styles.orderBtnTextActive]}>
                {t('useBuyOrder')}: {material.useBuyOrder ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.addBtn} onPress={addMaterial} disabled={materials.length >= 8}>
          <Text style={styles.addBtnText}>{copy.add}</Text>
        </TouchableOpacity>
        <NumberInput
          label={copy.returnRate}
          value={resourceReturnPercent}
          onChangeText={setResourceReturnPercent}
          info={copy.returnInfo}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{lang === 'fr' ? '2. Craft' : '2. Craft'}</Text>
        <NumberInput
          label={t('itemValue')}
          value={craftingItemValue}
          onChangeText={setCraftingItemValue}
          info={lang === 'fr' ? "Item Value du produit crafté" : 'Item Value of crafted product'}
        />
        <NumberInput label={t('stationTax')} value={stationTax} onChangeText={setStationTax} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{lang === 'fr' ? '3. Vente du produit fini' : '3. Sell finished product'}</Text>
        <NumberInput label={t('productPrice')} value={productSellPrice} onChangeText={setProductSellPrice} />
        <TouchableOpacity
          style={[styles.orderBtn, useSellOrder && styles.orderBtnActive]}
          onPress={() => setUseSellOrder((value) => !value)}
        >
          <Text style={[styles.orderBtnText, useSellOrder && styles.orderBtnTextActive]}>
            {t('useSellOrder')}: {useSellOrder ? 'ON' : 'OFF'}
          </Text>
        </TouchableOpacity>
      </View>

      <NumberInput label={t('quantity')} value={quantity} onChangeText={setQuantity} />

      {result && (
        <ResultCard
          title={lang === 'fr' ? 'Résultat Craft' : 'Craft Result'}
          highlight={{ value: result.totalProfit, label: result.totalProfit >= 0 ? t('profit') : t('loss') }}
          rows={[
            {
              label: lang === 'fr' ? 'Achat brut des matériaux' : lang === 'es' ? 'Compra bruta de materiales' : 'Gross material purchase',
              value: `${Math.round(result.grossMaterialCost)} silver`,
            },
            {
              label: lang === 'fr' ? 'Valeur des ressources retournées' : lang === 'es' ? 'Valor de recursos devueltos' : 'Returned resource value',
              value: `-${Math.round(result.returnedMaterialValue)} silver`,
            },
            { label: t('materialCost'), value: `${Math.round(result.materialCost)} silver` },
            ...(result.buyOrderFees > 0 ? [{ label: t('setupFeeBuy'), value: `${result.buyOrderFees} silver` }] : []),
            ...(useSellOrder ? [{ label: t('setupFeeSell'), value: `${result.marketplace.setupFeeSell} silver` }] : []),
            { label: t('salesTax'), value: `${result.marketplace.salesTax} silver` },
            { label: t('craftingCost'), value: `${result.crafting.totalFee} silver` },
            { label: t('upfrontInvestment'), value: `${Math.round(result.upfrontInvestment)} silver`, bold: true },
            { label: t('fees') + ' ' + t('total'), value: `${result.totalFees} silver`, bold: true, color: COLORS.loss },
            { label: t('roi'), value: `${result.roi.toFixed(1)}%`, color: result.roi >= 0 ? COLORS.profit : COLORS.loss, bold: true },
          ]}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl * 2 },
  title: { color: COLORS.primary, fontSize: FONT_SIZE.title, fontWeight: '800', marginBottom: SPACING.md },
  infoBox: { backgroundColor: COLORS.info + '15', borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.lg, borderLeftWidth: 3, borderLeftColor: COLORS.info },
  infoText: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm },
  section: { marginTop: SPACING.lg, marginBottom: SPACING.sm },
  sectionTitle: { color: COLORS.primary, fontSize: FONT_SIZE.lg, fontWeight: '700', marginBottom: SPACING.sm },
  materialCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  materialHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  materialTitle: { color: COLORS.text, fontWeight: '700', fontSize: FONT_SIZE.md },
  removeText: { color: COLORS.loss, fontSize: FONT_SIZE.sm },
  orderBtn: { paddingVertical: SPACING.sm, alignItems: 'center', borderRadius: BORDER_RADIUS.sm, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginVertical: SPACING.xs },
  orderBtnActive: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  orderBtnText: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm },
  orderBtnTextActive: { color: COLORS.primary, fontWeight: '600' },
  addBtn: { borderColor: COLORS.info, borderWidth: 1, borderRadius: BORDER_RADIUS.sm, padding: SPACING.sm, alignItems: 'center', marginBottom: SPACING.md },
  addBtnText: { color: COLORS.info, fontWeight: '700' },
});
