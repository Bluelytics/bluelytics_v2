create table currency_map(
    ID int primary key,
    code VARCHAR(3),
    name varchar(200)
);

create table currency_values (
    scraped_dt date,
    currency_id int references currency_map(id),
    value numeric(30,2),
    primary key (scraped_dt, currency_id)
);

create table dolar_values (
    scraped_at timestamp,
    source varchar(20),
    value_buy numeric(30,2),
    value_sell numeric(30,2)
);