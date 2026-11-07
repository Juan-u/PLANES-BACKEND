export function runtimePort(value=process.env.PORT??'3000') {
 if(!/^\d+$/.test(String(value))||Number(value)<1||Number(value)>65535)throw new Error('PORT debe ser un puerto válido.');
 return Number(value);
}
