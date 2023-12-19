/* eslint-disable react-hooks/exhaustive-deps */
import * as React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  RefreshControl,
  AppState,
} from 'react-native';
import {ScrollView} from 'react-native-gesture-handler';
import {useEffect, useState} from 'react';
import {RFPercentage} from 'react-native-responsive-fontsize';

export default function ValueScreen() {
  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}>
        <View style={styles.logoContainer}>
          <Image
            source={require('../assets/images/icon.png')}
            style={styles.logoImage}
          />
        </View>

        <DolarCotizacion />
      </ScrollView>
    </View>
  );
}

export function DolarCotizacion() {
  const [dolar, setDolar] = useState({});
  const [loading, setLoading] = useState(true);
  const [appState, setAppState] = useState(AppState.currentState);


  useEffect(() => {
        fetch('https://api.bluelytics.com.ar/v2/latest')
        .then(response => response.json())
        .then(json => setDolar(json))
        .catch(error => console.error(error))
        .finally(() => {
          setLoading(false);
        });
  }, [loading]);

  const onRefresh = React.useCallback(() => {
    setLoading(true);
  });

  useEffect(() => {
    AppState.addEventListener("change", _handleAppStateChange);

    return () => {
      AppState.removeEventListener("change", _handleAppStateChange);
    };
  }, []);

  const _handleAppStateChange = nextAppState => {
    if (nextAppState === "active") {
      onRefresh();
    }
    setAppState(nextAppState);
  };

  return (
    <SafeAreaView style={styles.cotizacionContainer}>
      <ScrollView
        contentContainerStyle={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={onRefresh} />
        }>
        <ListaDolares dolares={dolar} />
      </ScrollView>
    </SafeAreaView>
  );
}

export function ListaDolares(dolares) {
  var DolarBlue =
    'blue' in dolares.dolares ? (
      <DolarValor
        id="blue"
        valor={dolares.dolares.blue}
        nombre="Dolar Blue/Libre"
        color="#221199"
      />
    ) : null;
  var DolarOficial =
    'oficial' in dolares.dolares ? (
      <DolarValor
        id="oficial"
        valor={dolares.dolares.oficial}
        nombre="Dolar Oficial"
        color="#229922"
      />
    ) : null;

  return (
    <View>
      <View style={{flex: 2, marginBottom: 30}}>{DolarBlue}</View>
      <View style={{flex: 2, marginBottom: 30}}>{DolarOficial}</View>
    </View>
  );
}

export function DolarValor(data) {
  var valueBuy = data.valor.value_buy;
  var valueSell = data.valor.value_sell;

  if ('multiplier' in data) {
    valueBuy = valueBuy * data.multiplier;
    valueSell = valueSell * data.multiplier;
  }

  return (
    <View>
      <Text style={[styles.tituloRateBlue, {color: data.color}]}>
        {data.nombre}
      </Text>
      <View style={{flex: 3, flexDirection: 'row'}}>
        <View style={{flex: 6, flexDirection: 'column'}}>
          <Text style={[styles.subtituloRateBlue, {color: data.color}]}>
            Compra
          </Text>
          <Text style={[styles.impPais, {color: data.color}]} />
          <Text style={[styles.rateBlue, {color: data.color}]}>
            {valueBuy.toFixed(2)}
          </Text>
        </View>
        <View style={{flex: 6, flexDirection: 'column'}}>
          <Text style={[styles.subtituloRateBlue, {color: data.color}]}>
            Venta
          </Text>
          <Text style={[styles.rateBlue, {color: data.color}]}>
            {valueSell.toFixed(2)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  tituloRateBlue: {
    fontSize: RFPercentage(4.5),
    textAlign: 'center',
  },
  rateBlue: {
    fontSize: RFPercentage(5),
    textAlign: 'center',
    fontWeight: 'bold',
  },
  subtituloRateBlue: {
    fontSize: RFPercentage(3.5),
    textAlign: 'center',
  },
  impPais: {
    fontSize: RFPercentage(2),
    textAlign: 'center',
  },
  contentContainer: {
    paddingTop: 5,
  },
  scrollView: {
    paddingTop: 3,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 15,
  },
  cotizacionContainer: {
    flex: 1,
  },
  logoImage: {
    height: RFPercentage(10),
    resizeMode: 'contain',
  },
});
