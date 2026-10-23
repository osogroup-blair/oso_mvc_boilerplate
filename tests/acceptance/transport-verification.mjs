import assert from "node:assert/strict";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import http2 from "node:http2";
import { Connection } from "@temporalio/client";
import { NativeConnection } from "@temporalio/worker";
import { temporalConnectionOptions } from "../../dist/lib/temporalTransport.js";
const manifest=JSON.parse(await readFile(process.env.PLATFORM_TEST_MANIFEST,"utf8"));assert.equal(manifest.owner,"mvc-boilerplate-platform-tests");
const root=resolve(manifest.artifactDirectory,"tls");await mkdir(root);const file=name=>resolve(root,name);
const openssl=args=>{const result=spawnSync("openssl",args,{encoding:"utf8"});if(result.status!==0)throw Error("Synthetic certificate generation failed");};
openssl(["req","-x509","-newkey","rsa:2048","-nodes","-keyout",file("ca.key"),"-out",file("ca.pem"),"-subj","/CN=Owned Test CA","-days","1"]);
openssl(["req","-x509","-newkey","rsa:2048","-nodes","-keyout",file("untrusted.key"),"-out",file("untrusted.pem"),"-subj","/CN=Untrusted Test CA","-days","1"]);
for(const name of ["server","client"]){
 openssl(["req","-newkey","rsa:2048","-nodes","-keyout",file(name+".key"),"-out",file(name+".csr"),"-subj",`/CN=${name==="server"?"localhost":"owned-client"}`]);
 await writeFile(file(name+".ext"),name==="server"?"subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth":"extendedKeyUsage=clientAuth");
 openssl(["x509","-req","-in",file(name+".csr"),"-CA",file("ca.pem"),"-CAkey",file("ca.key"),"-CAcreateserial","-out",file(name+".pem"),"-days","1","-extfile",file(name+".ext")]);
}
const backend=http2.connect(`http://${manifest.temporal.host}:${manifest.temporal.port}`);
const server=http2.createSecureServer({key:await readFile(file("server.key")),cert:await readFile(file("server.pem")),ca:await readFile(file("ca.pem")),requestCert:true,rejectUnauthorized:true});
const sessions=new Set();server.on("session",session=>{sessions.add(session);session.on("close",()=>sessions.delete(session));});
server.on("tlsClientError",()=>{});server.on("sessionError",()=>{});
server.on("stream",(stream,headers)=>{
 stream.on("error",()=>{});
 if(headers.authorization!=="Bearer synthetic-transport-key"){stream.respond({":status":200,"content-type":"application/grpc","grpc-status":"16","grpc-message":"Unauthorized"});stream.end();return;}
 const request=backend.request({...headers,":scheme":"http",":authority":`${manifest.temporal.host}:${manifest.temporal.port}`});let trailers={};
 request.on("response",headers=>stream.respond(headers,{waitForTrailers:true}));request.on("trailers",value=>trailers=value);
 stream.on("wantTrailers",()=>stream.sendTrailers(trailers));request.on("error",()=>stream.close());stream.pipe(request);request.pipe(stream);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const address=server.address();const options={NODE_ENV:"test",TEMPORAL_ADDRESS:`127.0.0.1:${address.port}`,TEMPORAL_TLS_ENABLED:true,TEMPORAL_TLS_CA_PATH:file("ca.pem"),TEMPORAL_TLS_CLIENT_CERT_PATH:file("client.pem"),TEMPORAL_TLS_CLIENT_KEY_PATH:file("client.key"),TEMPORAL_TLS_SERVER_NAME:"localhost",TEMPORAL_API_KEY:"synthetic-transport-key"};
let client,native;
try{
 client=await Connection.connect({...await temporalConnectionOptions(options),connectTimeout:3000});await client.workflowService.getSystemInfo({});
 native=await NativeConnection.connect({...await temporalConnectionOptions(options),connectTimeout:3000});
 await assert.rejects(Connection.connect({...await temporalConnectionOptions({...options,TEMPORAL_API_KEY:"wrong"}),connectTimeout:1500}));
 await assert.rejects(Connection.connect({...await temporalConnectionOptions({...options,TEMPORAL_TLS_CLIENT_CERT_PATH:undefined,TEMPORAL_TLS_CLIENT_KEY_PATH:undefined}),connectTimeout:1500}));
 await assert.rejects(Connection.connect({...await temporalConnectionOptions({...options,TEMPORAL_TLS_CA_PATH:file("untrusted.pem")}),connectTimeout:1500}));
 await assert.rejects(temporalConnectionOptions({...options,TEMPORAL_TLS_CLIENT_KEY_PATH:file("ca.key")}));
 await writeFile(resolve(manifest.artifactDirectory,"transport-results.json"),JSON.stringify({result:"PASS",checks:["actual Client and NativeConnection RPC over mTLS","API key rejection","missing client certificate rejection","mismatched private key rejection","untrusted server CA rejection"],scope:"Owned TLS/auth proxy to real owned Temporal server; not production configuration"},null,2));console.log("Owned Temporal TLS/mTLS/API-key verification: PASS");
}finally{await native?.close();await client?.close();backend.destroy();for(const session of sessions)session.destroy();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
