async function sendTransaction({card_number}){ const approved=card_number==='4111111111111111'; const rejected=card_number==='4000000000000002'||!approved; return {approved,rejected,estado:approved?'aprobado':'rechazado'}; }
module.exports={sendTransaction};
