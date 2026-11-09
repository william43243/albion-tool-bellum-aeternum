/** Small, lossless markdown subset. Unknown syntax stays visible, never executes HTML. */
export type MarkdownLine = { kind: 'text' | 'heading' | 'bullet' | 'code'; text: string };
export function markdownLines(content: string): MarkdownLine[] {
  let fenced = false;
  return content.split('\n').map(line => {
    if (line.trimStart().startsWith('```')) { fenced = !fenced; return { kind: 'code', text: line }; }
    if (fenced) return { kind: 'code', text: line };
    if (/^#{1,6}\s/.test(line)) return { kind: 'heading', text: line.replace(/^#{1,6}\s/, '') };
    if (/^[-*]\s/.test(line)) return { kind: 'bullet', text: '• ' + line.slice(2) };
    return { kind: 'text', text: line };
  });
}
export function inlineParts(text: string): { text: string; bold?: boolean; code?: boolean }[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map(part =>
    part.startsWith('**') && part.endsWith('**') ? { text: part.slice(2, -2), bold: true }
    : part.startsWith('`') && part.endsWith('`') ? { text: part.slice(1, -1), code: true }
    : { text: part });
}

export type MarkdownBlock={kind:'line';line:MarkdownLine}|{kind:'table';headers:string[];rows:string[][]};
function tableCells(line:string):string[]{
 const cells:string[]=[];let current='',code=false;
 for(let i=0;i<line.length;i++){
  const char=line[i];
  if(char==='\\'&&line[i+1]==='|'){current+='|';i++;continue;}
  if(char==='`')code=!code;
  if(char==='|'&&!code){cells.push(current.trim());current='';}else current+=char;
 }
 cells.push(current.trim());
 if(line.trimStart().startsWith('|'))cells.shift();
 if(line.trimEnd().endsWith('|')&&!line.trimEnd().endsWith('\\|'))cells.pop();
 return cells;
}
/** Recognize complete tables; incomplete streamed rows stay visible as ordinary text. */
export function markdownBlocks(content:string):MarkdownBlock[]{
 const lines=markdownLines(content),blocks:MarkdownBlock[]=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i],next=lines[i+1];
  if(line.kind==='text'&&line.text.includes('|')&&next?.kind==='text'){
   const headers=tableCells(line.text),separator=tableCells(next.text);
   if(headers.length&&headers.length===separator.length&&separator.every(cell=>/^:?-{3,}:?$/.test(cell))){
    const rows:string[][]=[];i++;
    while(i+1<lines.length&&lines[i+1].kind==='text'&&lines[i+1].text.includes('|')){
     const cells=tableCells(lines[i+1].text);if(cells.length!==headers.length)break;
     rows.push(cells);i++;
    }
    blocks.push({kind:'table',headers,rows});continue;
   }
  }
  blocks.push({kind:'line',line});
 }
 return blocks;
}
export function canSubmitChat(input: string, connected: boolean, model: string, busy: boolean): boolean {
  return Boolean(input.trim() && connected && model && !busy);
}
export function chooseAvailableModel(current: string, models: readonly { id: string }[]): string {
  return models.some(model => model.id === current) ? current : models[0]?.id ?? '';
}

/** Only completed turns are resent. Failed/aborted prompts must not be duplicated on retry. */
export function completedChatHistory(messages: readonly { role: 'user' | 'assistant'; content: string; state?: string }[]): { role: 'user' | 'assistant'; content: string }[] {
  const result: { role: 'user' | 'assistant'; content: string }[] = [];
  for (let index = 0; index < messages.length - 1; index++) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user.role === 'user' && assistant.role === 'assistant' && assistant.state === 'completed') {
      result.push({ role: user.role, content: user.content }, { role: assistant.role, content: assistant.content });
      index++;
    }
  }
  return result;
}

export type ChatErrorKind = 'response' | 'refusal' | 'session' | 'network' | 'other';
/** Classify safe provider codes, not guesses about account access from a failed answer. */
export function chatErrorPresentation(error: string, language: string) {
  const code = error.trim().toUpperCase();
  const kind: ChatErrorKind = code === 'MODEL_REFUSAL' ? 'refusal'
    : /^(STREAM_|SSE_|EMPTY_MODEL_RESPONSE$|EMPTY_RESPONSE$|EMPTY_BODY$|RESPONSE_INCOMPLETE$|INCOMPLETE_RESPONSE$|RESPONSE_FAILED$|OUTPUT_LIMIT$)/.test(code) ? 'response'
    : /^(SIGN_IN_REQUIRED|SESSION_EXPIRED|TOKEN_EXPIRED|ACCESS_TOKEN_EXPIRED|INVALID_GRANT|INVALID_TOKEN|AUTHENTICATION_ERROR|HTTP_401)$/.test(code) ? 'session'
    : /^(NETWORK_ERROR|NETWORK_UNAVAILABLE|NETWORK_REQUEST_FAILED|TIMEOUT|SOCKETTIMEOUTEXCEPTION|UNKNOWNHOSTEXCEPTION|CONNECTEXCEPTION|SOCKETEXCEPTION|SSLHANDSHAKEEXCEPTION|IOEXCEPTION)$/.test(code) ? 'network' : 'other';
  const translate = (fr: string, en: string, es: string) => language === 'fr' ? fr : language === 'es' ? es : en;
  const descriptions: Record<ChatErrorKind, string> = {
    response: translate('La réponse est vide, incomplète ou n’a pas pu être lue. Votre message est conservé : vous pouvez réessayer. Ce problème de réponse ne nécessite pas de nouvelle connexion.', 'The response is empty, incomplete, or could not be read. Your message is preserved so you can retry. This response issue does not require signing in again.', 'La respuesta está vacía, incompleta o no se pudo leer. Tu mensaje se conserva para reintentar. Este problema de respuesta no requiere iniciar sesión de nuevo.'),
    refusal: translate('Le modèle a refusé cette demande. Vous pouvez la reformuler. Ce n’est pas une panne de connexion.', 'The model declined this request. You can rephrase it. This is not a connection failure.', 'El modelo rechazó esta solicitud. Puedes reformularla. No es un fallo de conexión.'),
    session: translate('La session a expiré ou n’est plus valide. Vérifiez son état, puis reconnectez-vous si nécessaire.', 'The session has expired or is no longer valid. Check its status, then sign in again if needed.', 'La sesión ha caducado o ya no es válida. Revisa su estado e inicia sesión de nuevo si es necesario.'),
    network: translate('La communication réseau a échoué. Vérifiez votre accès Internet, puis réessayez. Votre message est conservé.', 'Network communication failed. Check your internet access, then retry. Your message is preserved.', 'Falló la comunicación de red. Revisa el acceso a Internet y reintenta. Tu mensaje se conserva.'),
    other: translate('La demande n’a pas abouti. Consultez le code ci-dessous et réessayez si nécessaire. Votre message est conservé.', 'The request did not finish. Check the code below and retry if appropriate. Your message is preserved.', 'La solicitud no terminó. Consulta el código de abajo y reintenta si corresponde. Tu mensaje se conserva.'),
  };
  return {
    kind,
    message: descriptions[kind],
    checkSession: kind === 'session',
    actionLabel: kind === 'session' ? translate('Vérifier la session', 'Check session', 'Verificar sesión')
      : kind === 'refusal' ? translate('Reformuler le message', 'Rephrase message', 'Reformular mensaje')
      : translate('Revenir au message', 'Back to message', 'Volver al mensaje'),
  };
}
