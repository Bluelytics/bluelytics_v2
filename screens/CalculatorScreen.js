import * as React from 'react';
import {StyleSheet, Text, View, TextInput} from 'react-native';
import {useEffect, useState} from 'react';
import {Picker} from '@react-native-community/picker';
import Icon from 'react-native-vector-icons/FontAwesome';
import {RFPercentage} from 'react-native-responsive-fontsize';
import analytics from '@react-native-firebase/analytics';

export default function CalculatorScreen() {
  return <Calculator />;
}

export function Calculator() {
  const usdVal = {code: 'USD', name: 'USA Dollar', value: 1};
  const usdMap = {USD: 1};
  const emptyValores = {
    blueBuy: '-',
    blueSell: '-',
    oficialBuy: '-',
    oficialSell: '-',
  };

  const [dolar, setDolar] = useState({});
  const [currencies, setCurrencies] = useState([usdVal]);
  const [currencyMap, setCurrencyMap] = useState(usdMap);
  const [loading, setLoading] = useState(true);
  const [selectedValue, setSelectedValue] = useState('USD');
  const [valorInput, setValorInput] = useState('1000');
  const [valoresOutput, setValoresOutput] = useState(emptyValores);
  const [inverted, setInverted] = useState(false);

  const setCurrencyData = json => {
    setCurrencies(json);

    var currencyMapObj = {};

    json.forEach(val => {
      currencyMapObj[val.code] = val.value;
    });

    setCurrencyMap(currencyMapObj);
  };

  useEffect(() => {
    fetch('http://api.bluelytics.com.ar/data/json/currency.json')
      .then(response => response.json())
      .then(json => json.concat([usdVal]))
      .then(json => json.sort((a, b) => a.name > b.name))
      .then(json => setCurrencyData(json))
      .then(() => {
        fetch('http://api.bluelytics.com.ar/v2/latest')
          .then(response => response.json())
          .then(json => setDolar(json))
          .catch(error => console.error(error))
          .finally(() => {
            setLoading(false);
          });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    analytics().logSelectContent({
      content_type: 'selected_currency',
      item_id: selectedValue,
    })
  }, [selectedValue])

  useEffect(() => {
    if (
      valorInput === '' ||
      !('blue' in dolar) ||
      isNaN(valorInput) ||
      isNaN(dolar.blue.value_sell) ||
      isNaN(currencyMap[selectedValue])
    ) {
      setValoresOutput(emptyValores);
    } else {
      const toCurrency = (valorIn, dolarValue, currCode) => {
        return (
          (parseFloat(valorIn) / dolarValue) *
          currencyMap[currCode]
        ).toFixed(2);
      };

      const fromCurrency = (valorIn, dolarValue, currCode) => {
        return (
          (parseFloat(valorIn) / currencyMap[currCode]) *
          dolarValue
        ).toFixed(2);
      };

      if (inverted) {
        setValoresOutput({
          blueSell: fromCurrency(
            valorInput,
            dolar.blue.value_sell,
            selectedValue,
          ),
          blueBuy: fromCurrency(
            valorInput,
            dolar.blue.value_buy,
            selectedValue,
          ),
          oficialSell: fromCurrency(
            valorInput,
            dolar.oficial.value_sell * 1.65,
            selectedValue,
          ),
          oficialBuy: fromCurrency(
            valorInput,
            dolar.oficial.value_buy,
            selectedValue,
          ),
        });
      } else {
        setValoresOutput({
          blueSell: toCurrency(
            valorInput,
            dolar.blue.value_sell,
            selectedValue,
          ),
          blueBuy: toCurrency(valorInput, dolar.blue.value_buy, selectedValue),
          oficialSell: toCurrency(
            valorInput,
            dolar.oficial.value_sell * 1.65,
            selectedValue,
          ),
          oficialBuy: toCurrency(
            valorInput,
            dolar.oficial.value_buy,
            selectedValue,
          ),
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorInput, selectedValue, currencyMap, dolar, inverted]);

  const changeCurrency = code => {
    setSelectedValue(code);
  };

  const changeValorInput = newValue => {
    if (!isNaN(newValue)) {
      setValorInput(newValue.trim());
    }
  };

  const invertir = () => {
    var newInput = (
      (parseFloat(valoresOutput.blueBuy) + parseFloat(valoresOutput.blueSell)) /
      2
    ).toFixed(2);
    setValorInput(newInput);
    setInverted(!inverted);
  };

  return (
    <View style={styles.container}>
      <View
        style={{
          flexDirection: 'column',
          justifyContent: 'space-evenly',
          height: '100%',
        }}>
        <View style={{flex: 1}}>
          <Text style={styles.helpText}>
            Debajo podes elegir desde o a que moneda queres convertir pesos
            argentinos.{'\n'}
          </Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            flex: 1,
            justifyContent: 'center',
            alignItems: 'flex-end',
          }}>
          <Picker
            style={{flex: 1, maxWidth: '70%'}}
            selectedValue={selectedValue}
            onValueChange={(value, key) => changeCurrency(value)}
            prompt="Elegi la moneda a convertir">
            {CurrencyList(currencies)}
          </Picker>
        </View>

        <View style={{flexDirection: 'column', flex: 2, alignItems: 'center'}}>
          <View
            style={{
              flexDirection: 'row',
              flex: 1,
              alignItems: 'flex-end',
              marginBottom: 5,
            }}>
            <TextInput
              style={styles.valorInput}
              onChangeText={text => changeValorInput(text)}
              value={valorInput}
              keyboardType="numeric"
            />
            <Text style={styles.currencyInput}>
              {inverted ? selectedValue : 'ARS'}
            </Text>
          </View>
          <View style={{flex: 1}}>
            <Icon.Button
              width={90}
              name="arrows-v"
              backgroundColor="#221199"
              onPress={() => {
                invertir();
              }}>
              Invertir
            </Icon.Button>
          </View>
        </View>

        <View style={{flex: 4}}>
          <MonedaValores
            valores={valoresOutput}
            inverted={inverted}
            currency={selectedValue}
          />
        </View>
      </View>
    </View>
  );
}

export function MonedaValores(data) {
  var dolares = data.valores;

  return (
    <View style={{flexDirection: 'column', height: '100%'}}>
      <View style={{flex: 1, marginBottom: 5}}>
        <MonedaComponente
          buy={dolares.blueBuy}
          sell={dolares.blueSell}
          inverted={data.inverted}
          currency={data.currency}
          nombre="Blue/Libre"
          color="#221199"
        />
      </View>
      <View style={{flex: 1, marginBottom: 5}}>
        <MonedaComponente
          buy={dolares.oficialBuy}
          sell={dolares.oficialSell}
          inverted={data.inverted}
          currency={data.currency}
          nombre="Oficial"
          color="#229922"
        />
      </View>
    </View>
  );
}

export function MonedaComponente(data) {
  return (
    <View>
      <Text style={[styles.tituloRate, {color: data.color}]}>
        {data.nombre}
      </Text>
      <View style={{flex: 3, flexDirection: 'row'}}>
        <View style={{flex: 6, flexDirection: 'column'}}>
          <Text style={[styles.subtituloRateValue, {color: data.color}]}>
            Compra {data.inverted ? 'ARS' : data.currency}
          </Text>
          <Text style={[styles.rateValue, {color: data.color}]}>
            {parseFloat(data.buy).toLocaleString('en-US')}
          </Text>
        </View>
        <View style={{flex: 6, flexDirection: 'column'}}>
          <Text style={[styles.subtituloRateValue, {color: data.color}]}>
            Venta {data.inverted ? 'ARS' : data.currency}
          </Text>
          <Text style={[styles.rateValue, {color: data.color}]}>
            {parseFloat(data.sell).toLocaleString('en-US')}
          </Text>
        </View>
      </View>
    </View>
  );
}

function CurrencyList(currencies) {
  if (currencies) {
    return currencies.map(item => {
      return (
        <Picker.Item label={item.name} value={item.code} key={item.code} />
      );
    });
  } else {
    return null;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  helpText: {
    fontSize: RFPercentage(2),
    flex: 1,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontStyle: 'italic',
  },
  valorInput: {
    height: 50,
    flex: 5,
    textAlign: 'right',
    fontWeight: 'bold',
    fontSize: 20,
    marginRight: 10,
    marginLeft: 20,
    paddingRight: 5,
    borderWidth: 1,
    borderColor: '#dadada',
  },
  currencyInput: {
    flex: 1,
    fontWeight: 'bold',
    paddingBottom: 15,
  },
  tituloRate: {
    fontSize: RFPercentage(3.2),
    textAlign: 'center',
  },
  rateValue: {
    fontSize: RFPercentage(3.7),
    textAlign: 'center',
    fontWeight: 'bold',
  },
  subtituloRateValue: {
    fontSize: RFPercentage(2),
    textAlign: 'center',
  },
});
