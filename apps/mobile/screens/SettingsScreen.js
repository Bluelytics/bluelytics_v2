/* eslint-disable react-hooks/exhaustive-deps */
import * as React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Switch,
  TouchableOpacity
} from 'react-native';
import {ScrollView} from 'react-native-gesture-handler';
import {useEffect, useState} from 'react';
import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import analytics from '@react-native-firebase/analytics';
import {RFPercentage} from 'react-native-responsive-fontsize';


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
      
      <View style={{flex:1, flexDirection: 'column'}}>
        <AlertasBlue style={{flex:1}}></AlertasBlue>
        <Text style={styles.helpTextAlerta}>Mientras tengas activadas las alertas, recibiras notificaciones en el celular cada vez que haya un cambio significativo en el valor de venta del Dolar Blue.</Text>

      </View>
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

      <View style={styles.containerInSection}>
          <View style={styles.containerInnerSection}>
              <Text style={styles.text} numberOfLines={1} ellipsizeMode={'tail'}>
              Activar Alertas Dolar Blue
              </Text>
              <Switch style={styles.switchAlertas}
                trackColor={{ false: "#767577", true: "#81b0ff" }}
                thumbColor={isSubscribed ? "#221199" : "#f4f3f4"}
                onValueChange={(value) => toggleSwitch(value)}
                value={isSubscribed}
              />
          </View>
      </View>
      
      )
  }
  
}



const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  switchAlertas:{
    flex:1
  },
  helpTextAlerta:{
    flex:1,
    fontSize: RFPercentage(3),
    paddingTop:25,
    textAlign: 'center'
  },
  containerSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
},
containerInSection: {
    flex: 1, 
    margin:10
},
containerInnerSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center'
},
text: {
    flex: 6,
    flexDirection: 'row',
    fontSize: RFPercentage(3),
    color: 'black'
},
});