"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { quarantineInventoryLot } from "../pembelian/actions";

export default function QuarantineEvidenceForm({ lotId, maxWeight }: { lotId: string; maxWeight: number }) {
  const [files,setFiles]=useState<File[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const previews=useMemo(()=>files.map(file=>({file,url:URL.createObjectURL(file)})),[files]);
  useEffect(()=>()=>previews.forEach(item=>URL.revokeObjectURL(item.url)),[previews]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError("");
    const form=new FormData(event.currentTarget);
    form.set("lotId",lotId);
    const result=await quarantineInventoryLot(form);
    setBusy(false);
    if(!result.ok){setError(result.error);return;}
    window.location.reload();
  }
  return <form onSubmit={submit} style={{display:"grid",gap:8,minWidth:0,maxWidth:520,padding:12,border:"1px solid var(--border, #888)",borderRadius:10}}>
    <strong>Bukti Foto Karantina</strong>
    <label style={{display:"grid",gap:5}}>Berat yang dikarantina (kg)
      <input name="weightKg" type="number" min="0.001" max={maxWeight} step="0.001" required />
    </label>
    <label style={{display:"grid",gap:5}}>Alasan Karantina
      <textarea name="reason" minLength={3} maxLength={1000} rows={2} required />
    </label>
    <label style={{display:"grid",gap:5}}>Foto barang bermasalah · wajib
      <small>Ambil foto dengan kamera belakang atau pilih dari galeri. JPG, PNG, WEBP · maks. 10 MB/foto.</small>
      <span>📷 Ambil dengan Kamera</span><input name="files" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple required={files.length===0} onChange={event=>{const selected=Array.from(event.currentTarget.files??[]);setFiles(current=>[...current,...selected]);}}/><span>🖼️ Pilih dari Galeri</span><input name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple required={files.length===0} onChange={event=>setFiles(current=>[...current,...Array.from(event.currentTarget.files??[])])}/>
    </label>
    {!!previews.length&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{previews.map(({file,url})=><figure key={file.name+file.lastModified} style={{margin:0,width:88}}>
      <img src={url} alt={file.name} style={{width:88,height:76,objectFit:"cover",borderRadius:6}}/>
      <figcaption style={{fontSize:10,overflowWrap:"anywhere"}}>{file.name}</figcaption>
    </figure>)}</div>}
    {error&&<p role="alert" style={{color:"crimson"}}>{error}</p>}
    <button type="submit" disabled={busy||!files.length}>{busy?"Menyimpan Karantina...":"Simpan Karantina + Foto"}</button>
  </form>;
}
