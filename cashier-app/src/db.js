const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getRawState(){
  try{
    const r = await prisma.rawState.findUnique({ where: { id: 'main' } });
    return r ? r.data : null;
  }catch(e){
    console.error('DB getRawState error', e.message || e);
    // If DB not configured, return null to allow file fallback
    return null;
  }
}

async function saveRawState(state){
  try{
    await prisma.rawState.upsert({ where: { id: 'main' }, update: { data: state }, create: { id: 'main', data: state } });
  }catch(e){
    console.error('DB saveRawState error', e.message || e);
    return null;
  }
}

module.exports = { prisma, getRawState, saveRawState };
