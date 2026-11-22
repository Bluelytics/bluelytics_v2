
create table alertas_dolar (
    id SERIAL,
    alert_at timestamp,
    value_buy numeric(30,2),
    value_sell numeric(30,2)
);

create table actualizaciones_sociales (
    id SERIAL,
    social_network varchar(100),
    update_at timestamp,
    value_buy numeric(30,2),
    value_sell numeric(30,2)
);

create table actualizaciones_sociales_weekly (
    id SERIAL,
    social_network varchar(100),
    sent_at timestamp
);