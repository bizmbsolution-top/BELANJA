insert into public.expense_categories(name,description)
select v.name,v.description
from (values
 ('Fee Kemitraan','Imbalan mitra atau pihak penghubung; dapat digunakan pada pengeluaran umum maupun biaya penjualan berbasis BA.'),
 ('Fee Operasional','Biaya koordinasi dan operasional lapangan.'),
 ('Fee Keamanan','Biaya pengamanan kegiatan, lokasi, atau barang.'),
 ('Fee Bongkar Muat','Biaya penanganan, pemuatan, dan pembongkaran barang.'),
 ('Fee Pemeriksaan','Biaya sampling, pengujian kadar, dan pemeriksaan barang.')
) as v(name,description)
where not exists(select 1 from public.expense_categories c where lower(c.name)=lower(v.name));