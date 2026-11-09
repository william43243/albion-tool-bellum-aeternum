package com.albion.market.siwc;
import java.io.*;
/** Bounded SSE data-event parser. Handles CRLF, comments and multiline data. */
public final class SseReader {
 private final Reader reader; private final int limit; private int count;
 public SseReader(Reader r,int maxCharacters){reader=r;limit=maxCharacters;}
 public String nextEvent() throws IOException {
  StringBuilder data=new StringBuilder();String line;
  while((line=line())!=null){
   if(line.isEmpty()){if(data.length()>0)return data.substring(0,data.length()-1);continue;}
   if(line.startsWith("data:")){String value=line.substring(5);if(value.startsWith(" "))value=value.substring(1);data.append(value).append('\n');}
  }
  return data.length()==0?null:data.substring(0,data.length()-1);
 }
 private String line() throws IOException {
  StringBuilder s=new StringBuilder();int c;
  while((c=reader.read())!=-1){if(++count>limit)throw new IOException("STREAM_LIMIT");if(c=='\n')break;if(s.length()>=1048576)throw new IOException("SSE_LINE_LIMIT");if(c!='\r')s.append((char)c);}
  return c==-1&&s.length()==0?null:s.toString();
 }
}
