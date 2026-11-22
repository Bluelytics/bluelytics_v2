import Icon from 'react-native-vector-icons/dist/FontAwesome';
import * as React from 'react';

export default function TabBarIcon(props) {
  return (
    <Icon
      name={props.name}
      size={23}
      style={{marginBottom: -3}}
      color={props.focused ? '#2f95dc' : '#cccccc'}
    />
  );
}
