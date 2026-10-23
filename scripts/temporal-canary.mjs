import { temporalClientGateway } from "../dist/lib/temporalClient.js";
try { console.log(JSON.stringify({status:"PASS",...await temporalClientGateway.applicationCanary()})); }
catch { console.error("Application Worker canary failed within deadline");process.exitCode=1; }
finally { await temporalClientGateway.close(); }
