/* eslint-disable react-hooks/exhaustive-deps */
import * as React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Switch
} from 'react-native';
import {ScrollView} from 'react-native-gesture-handler';
import {useEffect, useState} from 'react';
import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import analytics from '@react-native-firebase/analytics';
import messaging from '@react-native-firebase/messaging';

async function requestUserPermission() {
  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

  if (enabled) {
    console.log('Authorization status:', authStatus);
  }
}

export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}>
      
      <View style={styles.alertContainer}>
          <Text style={styles.textAlertas}>Activar Alertas Dolar Blue</Text>
        <AlertasBlue></AlertasBlue>
      </View>
      <View style={{flex:1, flexDirection: 'row'}}>

        <Text style={styles.helpTextAlerta}>Mientras tengas activadas las alertas, recibiras notificaciones en el celular cada vez que haya un cambio significativo en el valor de venta del Dolar Blue.</Text>
      </View>
      </ScrollView>
    </View>
  );
}

export function AlertasBlue() {
  const [isSubscribed, setisSubscribed] = useState(null);
  const toggleSwitch = async(newState) => {
    setisSubscribed(newState)
    console.log(newState);
    if(newState == true){
      messaging()
      .subscribeToTopic('alertas-blue')
      .then(() => _storeSub('true'))
      .then(() => analytics().logEvent('subscribe_alertas_blue', {}));

      requestUserPermission()
    }else if (newState == false){
      messaging()
      .unsubscribeFromTopic('alertas-blue')
      .then(() => _storeSub('false'))
      .then(() => analytics().logEvent('unsubscribe_alertas_blue', {}));
    }
  }

  _storeSub = async (value) => {
      try {
          await AsyncStorage.setItem('subState', value);
      } catch (error) {
        console.log(error);
      }
  }

  _retrieveSub = async () => {
    try {
        const value = await AsyncStorage.getItem('subState');
        console.log('Retrieved ' + value)
        return(value == 'true')
    } catch (error) {
      console.log(error);
    }
}

  useEffect(() => {
    _retrieveSub()
      .then(val => setisSubscribed(val))
   }, []);

  if(isSubscribed === null){
    return(<Text>...</Text>)
  }else{
    return(
      <Switch style={styles.switchAlertas}
              trackColor={{ false: "#767577", true: "#81b0ff" }}
              thumbColor={isSubscribed ? "#221199" : "#f4f3f4"}
              ios_backgroundColor="#3e3e3e"
              onValueChange={(value) => toggleSwitch(value)}
              value={isSubscribed}
            />
      )
  }
  
}



const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    paddingTop: 100,
  },
  alertContainer: {
    flex:1,
    flexDirection: 'row',
    marginRight: 30,
    marginRight:20,
    marginLeft:20,
    marginTop:10,
    paddingTop:20,
    paddingBottom:20,
    backgroundColor:'#f7f7f7',
    borderRadius:10,
    borderWidth: 4,
    borderColor: '#eeeeee'
  },
  textAlertas:{
    fontSize:16,
    flex:4,
    flexDirection: 'column',
    textAlign: 'right',
  },
  switchAlertas:{
    flex:1,
    flexDirection: 'column',
    justifyContent: 'space-between'
  },
  helpTextAlerta:{
    flex:1,
    fontSize:12,
    paddingTop:25,
    textAlign: 'center'
  }
});