import React,{createContext,useContext} from 'react';
export const CHAT_TEXT_SCALES=[0.75,0.85,1,1.15,1.3] as const;
export const CHAT_TEXT_SCALE_KEY='@albion/openai-chat-text-scale/v1';
export function validChatTextScale(value:unknown):number{return CHAT_TEXT_SCALES.includes(value as typeof CHAT_TEXT_SCALES[number])?Number(value):1;}
export function nextChatTextScale(value:number,direction:-1|1):number{
 const index=CHAT_TEXT_SCALES.indexOf(validChatTextScale(value) as typeof CHAT_TEXT_SCALES[number]);
 return CHAT_TEXT_SCALES[Math.max(0,Math.min(CHAT_TEXT_SCALES.length-1,index+direction))];
}
const ChatReadingContext=createContext(1);
export const ChatReadingProvider=ChatReadingContext.Provider;
export const useChatTextScale=()=>useContext(ChatReadingContext);
