import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import {closeDb} from "@/lib/db/client";
import {loadLatestSolicitationRequirements} from "@/lib/procurement/requirements/persistence";

const canRun=Boolean(process.env.DATABASE_URL);
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");

test("previously unlinked listing requirements hydrate without AI; revoking raw-field authority makes them partial again", {skip:!canRun},async()=>{
  const sql=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
  let sourceId:string|null=null;
  try {
    const raw={title:"Annual Polling Licenses",
      description:{html:"<p>Need 10 annual licenses. Please bid 10 licenses as one lump sum.</p>"},
      dueDate:{utcDate:"2026-09-23T17:00:00.000Z"},
      agency:{name:"City of Houston",location:{region:{abbr:"TX"}}}};
    const uid="metadata-provenance-"+process.pid+"-"+Date.now();
    const [source]=await sql.unsafe<{id:string}[]>(
      "INSERT INTO source_records (source,source_record_id,raw_payload,payload_hash) VALUES ($1,$2,$3::jsonb,$4) RETURNING id",
      ["fixture",uid,JSON.stringify(raw),hash(JSON.stringify(raw))]);
    sourceId=source!.id;
    const provenance=Object.fromEntries(["description","dueAt","location"].map((field)=>[
      field,{authority:"authoritative",sourceRecordPk:source!.id},
    ]));
    const [opportunity]=await sql.unsafe<{id:string}[]>(
      "INSERT INTO opportunities (source_record_id,source,source_opportunity_id,title,description,due_at,location,field_provenance) VALUES ($1,'fixture',$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING id",
      [source!.id,uid,"Annual Polling Licenses",raw.description.html,
      "2026-09-23T17:00:00.000Z",JSON.stringify({locality:"Houston",region:"TX",country:"US"}),
      JSON.stringify(provenance)]);
    const content={
      summary:"Ten annual licenses",scope:[],deliverables:[],workBreakdown:[],
      location:[{key:"location",text:"The solicitation is issued by the City of Houston, TX.",details:{sourceSegmentIds:[]}}],
      schedule:[{key:"due",text:"Bids are due by 2026-09-23T17:00:00.000Z.",details:{sourceSegmentIds:[]}}],
      quantities:[{key:"quantity",text:"10 annual licenses.",details:{sourceSegmentIds:[]}},
        {key:"quantity-short",text:"10 licenses.",details:{sourceSegmentIds:[]}}],
      qualifications:[],insuranceBonding:[],mandatoryEvents:[],
      pricingInstructions:[{key:"pricing",text:"Bid 10 licenses as one lump sum.",details:{sourceSegmentIds:[]}}],
      submissionComponents:[],evaluationCriteria:[],disqualifiers:[],questionsAmbiguities:[],
    };
    const [understanding]=await sql.unsafe<{id:string}[]>(
      "INSERT INTO solicitation_understandings (opportunity_id,input_fingerprint,schema_version,prompt_version,model_provider,model_name,generation_trigger,status,completeness_status,structured_output) VALUES ($1,$2,'1','fixture','fixture','mock','manual','completed','complete',$3::jsonb) RETURNING id",
      [opportunity!.id,hash(JSON.stringify(content)),JSON.stringify(content)]);
    for(const [section,findings] of Object.entries(content)){
      if (!Array.isArray(findings)) continue;
      for(const finding of findings) await sql.unsafe(
        "INSERT INTO solicitation_requirements (opportunity_id,solicitation_understanding_id,requirement_key,requirement_type,requirement_level,text,source_section,source_finding_key,details) VALUES ($1,$2,$3,'scope','required',$4,$5,$6,$7::jsonb)",
        [opportunity!.id,understanding!.id,section+":"+finding.key,finding.text,section, finding.key,JSON.stringify(finding.details)]);
    }
    const first=await loadLatestSolicitationRequirements(opportunity!.id);
    assert.equal(first?.completenessStatus,"complete",JSON.stringify(first?.incompleteReasons));
    assert.equal(first?.requirements.length,5);
    for(const requirement of first!.requirements) {
      assert.equal(requirement.evidence.length,0);
      assert.equal(requirement.listingEvidence?.sourceRecordId,source!.id);
      assert.equal(requirement.listingEvidence?.payloadHash,hash(JSON.stringify(raw)));
      assert.match(requirement.listingEvidence?.excerpt??"",/\S/);
    }
    assert.deepEqual(await loadLatestSolicitationRequirements(opportunity!.id),first);
    await sql.unsafe("UPDATE opportunities SET field_provenance='{}'::jsonb WHERE id=$1",[opportunity!.id]);
    const revoked=await loadLatestSolicitationRequirements(opportunity!.id);
    assert.equal(revoked?.completenessStatus,"partial");
    assert.equal(revoked?.incompleteReasons.includes("requirement_evidence_missing"),true);
    assert.ok(revoked?.requirements.every((requirement)=>!requirement.listingEvidence));
  } finally {
    await closeDb();
    if(sourceId) await sql.unsafe("DELETE FROM source_records WHERE id=$1",[sourceId]);
    await sql.end({timeout:5});
  }
});
