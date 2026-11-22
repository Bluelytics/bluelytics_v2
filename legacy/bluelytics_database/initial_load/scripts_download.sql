select date(date), source_id, round(avg(value_buy),2), round(avg(value_sell),2)
from dolar_blue_dolarblue
group by date(date), source_id;

select date(date), curr_id, avg(value)
from dolar_blue_currencyvalue
group by date(date), curr_id;