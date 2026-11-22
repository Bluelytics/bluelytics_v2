

drop materialized view dolar_latest;
drop materialized view dolar_evolution;
drop materialized view currency_value_latest;

drop materialized view dolar_latest;

create materialized view dolar_latest as
with rnked as (
			select
				*,
				row_number() over(partition by source order by scraped_at desc) rnk
			from dolar_values
			where scraped_at >= current_date - 3
		),
		last_euro as (
			select 
				value,
				row_number() over (order by scraped_dt desc) rnk
			from currency_values
			where currency_id = 22
		)
		select
		  case when source = 'oficial' then 'oficial' else 'blue' end as tipo,
		  max(scraped_at) as updated_at,
		  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_buy))::numeric(30,2) as value_buy,
		  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_sell))::numeric(30,2) as value_sell,
		  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_buy)/avg(last_euro.value))::numeric(30,2) as euro_buy,
		  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_sell)/avg(last_euro.value))::numeric(30,2) as euro_sell
		from rnked r
		left join last_euro on last_euro.rnk = 1
		where r.rnk = 1
		group by 1;


CREATE UNIQUE INDEX IF NOT EXISTS dolar_latest_ix ON dolar_latest (tipo) ;

create materialized view currency_value_latest as
select code, name, value
from currency_values v
inner join currency_map m on v.currency_id = m.id
where scraped_dt = (select max(scraped_dt) from currency_values)
order by name
;

CREATE UNIQUE INDEX IF NOT EXISTS currency_value_latest_ix ON currency_value_latest (code) ;


create  materialized view dolar_evolution as
	with ranked as (
select
  date(scraped_at) as dttm,
  case when source = 'oficial' then 'Oficial' else 'Blue' end as tipo,
  scraped_at as updated_at,
  value_buy,
  value_sell,
  row_number() over(partition by date(scraped_at), case when source = 'oficial' then 'Oficial' else 'Blue' end order by scraped_at desc) rnk
from dolar_values
)
select
dttm,
tipo,
max(updated_at) as updated_at,
round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_buy))::numeric(30,2) as value_buy,
round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_sell))::numeric(30,2)  as value_sell
from ranked
where rnk < 50
group by dttm, tipo
;

CREATE UNIQUE INDEX IF NOT EXISTS dolar_evolution_ix ON dolar_evolution (dttm, tipo) ;