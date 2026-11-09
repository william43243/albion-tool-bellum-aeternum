import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/theme';
import { inlineParts, markdownBlocks } from './presentation';
import { useChatTextScale } from './reading';
const parts=(text:string)=>inlineParts(text).map((part,i)=><Text key={i} style={[part.bold&&styles.bold,part.code&&styles.inlineCode]}>{part.text}</Text>);
/** Selectable native text, including tables; no HTML execution. */
export default function ChatMarkdown({content}:{content:string}){
 const scale=useChatTextScale();
 return <View>{markdownBlocks(content).map((block,index)=>{
  if(block.kind==='table')return <ScrollView key={index} horizontal showsHorizontalScrollIndicator style={styles.table}>
   <View>{[block.headers,...block.rows].map((row,r)=><View key={r} style={[styles.row,r===0&&styles.tableHeader]}>{row.map((cell,c)=><Text selectable key={c} style={[styles.cell,{width:160*scale,fontSize:14*scale,lineHeight:21*scale},r===0&&styles.bold]}>{parts(cell)}</Text>)}</View>)}</View>
  </ScrollView>;
  const line=block.line;
  if(!line.text)return <View key={index} style={{height:8*scale}}/>;
  const size=line.kind==='heading'?18:line.kind==='code'?13:16;
  return <Text selectable key={index} style={[styles.text,line.kind==='heading'&&styles.heading,line.kind==='code'&&styles.code,{fontSize:size*scale,lineHeight:(size+8)*scale}]}>{line.kind==='code'?line.text:parts(line.text)}</Text>;
 })}</View>;
}
const styles=StyleSheet.create({
 text:{color:COLORS.text},heading:{fontWeight:'700',marginTop:10,marginBottom:6},bold:{fontWeight:'700'},
 inlineCode:{fontFamily:Platform.OS==='ios'?'Menlo':'monospace',backgroundColor:COLORS.surfaceLight},
 code:{fontFamily:Platform.OS==='ios'?'Menlo':'monospace',backgroundColor:COLORS.surfaceLight,paddingHorizontal:8},
 table:{marginVertical:10,borderWidth:1,borderColor:COLORS.border,borderRadius:8},row:{flexDirection:'row',borderBottomWidth:1,borderColor:COLORS.border},
 tableHeader:{backgroundColor:COLORS.surfaceLight},cell:{color:COLORS.text,padding:10,borderRightWidth:1,borderColor:COLORS.border},
});
