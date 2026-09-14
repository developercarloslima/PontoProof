import { useState } from 'react';
import { getCachedUser } from '../lib/api';
import Overview from './management/Overview';
import Employees from './management/Employees';
import Shifts from './management/Shifts';
import Worksites from './management/Worksites';
import Bank from './management/Bank';
import Payroll from './management/Payroll';
import Settings from './management/Settings';
import Devices from './management/Devices';
import Departments from './management/Departments';
import PresenceCodes from './management/PresenceCodes';
import SecurityReviews from './management/SecurityReviews';

export default function Management(){
 const user=getCachedUser(); const canAdmin=['ADMIN','HR'].includes(user?.role??'');
 const [tab,setTab]=useState('visao');
 const tabs=[['visao','Visão geral'],['equipe','Equipe'],...(canAdmin?[['setores','Setores'],['escalas','Escalas'],['locais','Locais'],['presenca','QR de presença'],['dispositivos','Dispositivos'],['seguranca','Revisão de segurança']]:[]),['banco','Banco de horas'],...(canAdmin?[['folha','Prévia da folha'],['regras','Configurações']]:[])];
 return <><div className="subnav">{tabs.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>{tab==='visao'&&<Overview/>}{tab==='equipe'&&<Employees editable={canAdmin}/>} {tab==='setores'&&canAdmin&&<Departments/>}{tab==='escalas'&&canAdmin&&<Shifts/>}{tab==='locais'&&canAdmin&&<Worksites/>}{tab==='presenca'&&canAdmin&&<PresenceCodes/>}{tab==='dispositivos'&&canAdmin&&<Devices/>}{tab==='seguranca'&&canAdmin&&<SecurityReviews/>}{tab==='banco'&&<Bank editable={canAdmin}/>}{tab==='folha'&&canAdmin&&<Payroll/>}{tab==='regras'&&canAdmin&&<Settings/>}</>;
}
